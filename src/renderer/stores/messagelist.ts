import { MessageState } from "deltachat-node"
import { getLogger } from "../../shared/logger"
import { MessageType } from "../../shared/shared-types"
import { DeltaBackend } from "../delta-remote"
import { PAGE_SIZE } from "./chat"
import { Action, Store, StoreDispatchSetState } from "./store2"

export type MessageId = number
const log = getLogger('renderer/message/MessageList')


export type MessageIds = Array<MessageId>

export type Message = MessageType | { msg : null}

export interface Messages {
	[key: number]: Message
}

export class MessageListPage {
	messageIds: MessageIds
	messages: Messages
	firstMessageIdIndex: number
	lastMessageIdIndex: number
	key: string
}


export interface PageStoreState {
	pages: { [key:string] : MessageListPage}
	pageOrdering: string[]
	chatId: number
	messageIds: MessageId[]
	loading: boolean
}

export function defaultPageStoreState(): PageStoreState {
	return {
		pages: {},
		pageOrdering: [],
		chatId: -1,
		messageIds: [],
		loading: false,
	}
}

export interface DispatchAfter {
  action: Action,
  isLayoutEffect: boolean
}
export type DispatchesAfter = DispatchAfter[]


export class PageStore extends Store<PageStoreState> {
  public currentlyLoadingPage: boolean = false
  updatePage(pageKey: string, updateObj: Partial<PageStoreState['pages']>) {
    return {
      ...this.state,
      pages: {
        ...this.state.pages,
        [pageKey]: {
          ...this.state.pages[pageKey],
          ...updateObj
        }
      }
    }
  }
  
  dispatchAfter(dispatchAfter: DispatchAfter) {
    console.log('Hello from dispatchAfter')
    dispatchAfter.isLayoutEffect ? this.pushLayoutEffect(dispatchAfter.action) : this.pushEffect(dispatchAfter.action)
  }
  
  dispatchesAfter(dispatchesAfter: DispatchesAfter) {
    dispatchesAfter.forEach(this.dispatchAfter.bind(this))
  }
  

  selectChat(chatId: number) {
    return this.dispatch('selectChat', async (state: PageStoreState, setState) => {
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)
      const firstUnreadMessageId = await DeltaBackend.call('messageList.getFirstUnreadMessageId', chatId)

      let [pages, pageOrdering]: [PageStoreState['pages'], PageStoreState['pageOrdering']] = [{}, []]

      if (firstUnreadMessageId !== -1) {
        let tmp = await this._loadPageWithFirstMessageIndex(messageIds, messageIds.indexOf(firstUnreadMessageId))
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {msgId: firstUnreadMessageId}, id: chatId})
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - PAGE_SIZE)
        let tmp = await this._loadPageWithFirstMessageIndex(messageIds, firstMessageIndexOnLastPage)
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {}, id: chatId})
      }
      
      
      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        loading: false
      })
    })
  }
  
  async jumpToMessage(messageId: number) {
    return this.dispatch('jumpToMessage', async (state: PageStoreState, setState) => {
      const message = await DeltaBackend.call('messageList.getMessage', messageId)
      const chatId = message.msg.chatId
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)
      const messageIndex = messageIds.indexOf(messageId)

      let {pages, pageOrdering} = await this._loadPageWithFirstMessageIndex(messageIds, messageIndex)
      this.pushLayoutEffect({type: 'SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0]}, id: chatId})
      
      
      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        loading: false
      })
    })

  }
  

  async loadPageBefore(withoutPages: string[], dispatchesAfter?: DispatchesAfter) {
    return this.dispatch('loadPageBefore', async (state: PageStoreState, setState) => {
      const firstPage = state.pages[state.pageOrdering[0]]
      
      if(!firstPage) {
        log.debug('loadPageBefore: firstPage is null, returning')
        return
      }
      
      const firstMessageIdIndexOnFirstPage = firstPage.firstMessageIdIndex

      const firstMessageIdIndexOnPageBefore = Math.max(0, firstMessageIdIndexOnFirstPage - PAGE_SIZE)
      
      if (firstMessageIdIndexOnPageBefore === firstMessageIdIndexOnFirstPage) {
        log.debug('loadPageBefore: no more messages, returning')
        return
      }

      const tmp = await this._loadPageWithFirstMessageIndex(state.messageIds, firstMessageIdIndexOnPageBefore)


      let modifiedState = this._withoutPages(this.state, withoutPages)


      this.dispatchesAfter(dispatchesAfter)
      setState({
        ...modifiedState,
        pageOrdering: [...tmp.pageOrdering, ...modifiedState.pageOrdering],
        pages: {
          ...modifiedState.pages,
          ...tmp.pages
        }
      })
    })
  }
  
  async loadPageAfter(withoutPages: string[], dispatchesAfter?: DispatchesAfter) {
    return this.dispatch('loadPageAfter', async (state: PageStoreState, setState) => {
      const lastPage = state.pages[state.pageOrdering[state.pageOrdering.length - 1]]
      
      if(!lastPage) {
        log.debug('loadPageAfter: lastPage is null, returning')
        return
      }
      
      const lastMessageIdIndexOnLastPage = lastPage.lastMessageIdIndex

      const firstMessageIdIndexOnPageAfter = Math.min(state.messageIds.length - 1, lastMessageIdIndexOnLastPage + 1)
      
      if (firstMessageIdIndexOnPageAfter === lastMessageIdIndexOnLastPage) {
        log.debug('loadPageAfter: no more messages, returning')
        return
      }

      const tmp = await this._loadPageWithFirstMessageIndex(state.messageIds, firstMessageIdIndexOnPageAfter)
      
      let modifiedState = this._withoutPages(this.state, withoutPages)

      this.dispatchesAfter(dispatchesAfter)
      setState({
        ...modifiedState,
        pageOrdering: [...modifiedState.pageOrdering, ...tmp.pageOrdering],
        pages: {
          ...modifiedState.pages,
          ...tmp.pages
        }
      })
    })
  }
  
  doneCurrentlyLoadingPage() {
    this.currentlyLoadingPage = false
  }
  async _loadPageWithFirstMessageIndex(messageIds: number[], pageFirstMessageIdIndex: number) : Promise<{pages: PageStoreState['pages'], pageOrdering: PageStoreState['pageOrdering']}> {
    if (pageFirstMessageIdIndex < 0 || pageFirstMessageIdIndex >= messageIds.length) {
      log.warn(`_loadPageWithFirstMessage: pageFirstMessageIdIndex out of bound, returning`)
      return {
        pages: {},
        pageOrdering: []
      }

    }
    const messageId = messageIds[pageFirstMessageIdIndex]

    if (this.currentlyLoadingPage === true) {
      log.warn(`_loadPageWithFirstMessage: we are already loading a page, returning`)
      return {
        pages: {},
        pageOrdering: []
      }
    }

    this.currentlyLoadingPage = true

    if (pageFirstMessageIdIndex === -1) {
      log.warn(`_loadPageWithFirstMessage: messageId ${messageId} is not in messageIds`)
      return {
        pages: {},
        pageOrdering: []
      }
    }
    
    const pageMessageIds = messageIds.slice(pageFirstMessageIdIndex, pageFirstMessageIdIndex + PAGE_SIZE);
    const pageLastMessageIdIndex = pageFirstMessageIdIndex + pageMessageIds.length - 1
    
    const pageMessages = await DeltaBackend.call('messageList.getMessages', pageMessageIds)

    const pageKey = `page-${pageFirstMessageIdIndex}-${pageLastMessageIdIndex}`
    
    return {
      pages: {
        [pageKey]: {
          firstMessageIdIndex: pageFirstMessageIdIndex,
          lastMessageIdIndex: pageLastMessageIdIndex,
          messageIds: pageMessageIds,
          messages: pageMessages,
          key: pageKey
        }
      },
      pageOrdering: [pageKey],
    }
  }
  
  removePage(pageKey: string) {
    this.dispatch('removePage', async (state, setState) => {
      setState(this._withoutPages(state, [pageKey]))
    })
  } 
  
  _withoutPages(state: PageStoreState, withoutPageKeys: string[]): PageStoreState {
    let pages: Partial<PageStoreState['pages']> = {}
    let pageOrdering: Partial<PageStoreState['pageOrdering']> = []
    
    let modified = false
    for (let pageKey of state.pageOrdering) {
      const without = withoutPageKeys.indexOf(pageKey) !== -1
     
      if (without) continue
      modified = true
      pages[pageKey] = state.pages[pageKey]
      pageOrdering.push(pageKey)
    }

    if (!modified) return state

    return {
        ...state,
        pageOrdering,
        pages
      }
    }
}

export const MessageListStore = new PageStore(defaultPageStoreState(), 'MessageListPageStore');
