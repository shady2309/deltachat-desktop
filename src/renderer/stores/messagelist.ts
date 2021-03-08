import { MessageState } from "deltachat-node"
import { getLogger } from "../../shared/logger"
import { Message2, MessageType } from "../../shared/shared-types"
import { DeltaBackend } from "../delta-remote"
import { PAGE_SIZE } from "./chat"
import { Action, Store, StoreDispatchSetState } from "./store2"

export type MessageId = number
const log = getLogger('renderer/message/MessageList')


export type MessageIds = Array<MessageId>

export class MessageListPage {
	messageIds: MessageIds
	messages: Message2[]
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
        const firstUnreadMessageIdIndex = messageIds.indexOf(firstUnreadMessageId)
        const endMessageIdIndex = Math.min(firstUnreadMessageId + PAGE_SIZE, messageIds.length - 1)
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstUnreadMessageId, endMessageIdIndex)
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {msgId: firstUnreadMessageId}, id: chatId})
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - PAGE_SIZE)
        const endMessageIdIndex = Math.min(firstMessageIndexOnLastPage + PAGE_SIZE, messageIds.length - 1)
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIndexOnLastPage, endMessageIdIndex)
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
  
  async jumpToMessage(chatId: number, messageId: number) {
    return this.dispatch('jumpToMessage', async (state: PageStoreState, setState) => {
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)
      log.debug(`jumpToMessage: chatId: ${chatId} messageId: ${messageId}`)
      
      const jumpToMessageIndex = messageIds.indexOf(messageId)
      const endMessageIndex = Math.min(jumpToMessageIndex + PAGE_SIZE, messageIds.length - 1)
      let {pages, pageOrdering} = await this._loadPageWithFirstMessageIndex(state.chatId, messageIds, jumpToMessageIndex, endMessageIndex)
      
      let pageBeforeIndexStart = Math.max(jumpToMessageIndex - PAGE_SIZE, 0)
      let pageBeforeIndexEnd = Math.max(jumpToMessageIndex - 1, 0)
      let {pages: pagesBefore, pageOrdering: pageOrderingBefore} = await this._loadPageWithFirstMessageIndex(state.chatId, messageIds, pageBeforeIndexStart, pageBeforeIndexEnd)
      this.pushLayoutEffect({type: 'SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0]}, id: chatId})
      
      
      setState({
        pages: {...pages, ...pagesBefore},
        pageOrdering: [...pageOrderingBefore, ...pageOrdering],
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

      const lastMessageIndexOnPageBefore = Math.min(firstMessageIdIndexOnFirstPage + PAGE_SIZE, firstPage.firstMessageIdIndex - 1)
      const tmp = await this._loadPageWithFirstMessageIndex(state.chatId, state.messageIds, firstMessageIdIndexOnPageBefore, lastMessageIndexOnPageBefore)  


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
      
      const lastMessageIndexOnPageAfter = Math.min(firstMessageIdIndexOnPageAfter + PAGE_SIZE, state.messageIds.length - 1)

      const tmp = await this._loadPageWithFirstMessageIndex(state.chatId, state.messageIds, firstMessageIdIndexOnPageAfter, lastMessageIndexOnPageAfter)
      
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
  async _loadPageWithFirstMessageIndex(chatId: number, messageIds: number[], startMessageIdIndex: number, endMessageIdIndex: number) : Promise<{pages: PageStoreState['pages'], pageOrdering: PageStoreState['pageOrdering']}> {
    if (startMessageIdIndex < 0 || startMessageIdIndex >= messageIds.length || endMessageIdIndex < startMessageIdIndex || endMessageIdIndex >= messageIds.length) {
      log.warn(`_loadPageWithFirstMessage: pageFirstMessageIdIndex out of bound, returning startMessageIdIndex: ${startMessageIdIndex} endMessageIdIndex: ${endMessageIdIndex}`)
      
      return {
        pages: {},
        pageOrdering: []
      }

    }
    const messageId = messageIds[startMessageIdIndex]

    if (this.currentlyLoadingPage === true) {
      log.warn(`_loadPageWithFirstMessage: we are already loading a page, returning`)
      return {
        pages: {},
        pageOrdering: []
      }
    }

    this.currentlyLoadingPage = true

    if (startMessageIdIndex === -1) {
      log.warn(`_loadPageWithFirstMessage: messageId ${messageId} is not in messageIds`)
      return {
        pages: {},
        pageOrdering: []
      }
    }
    
    const pageMessageIds = messageIds.slice(startMessageIdIndex, endMessageIdIndex + 1);
    
    const pageMessages = await DeltaBackend.call('messageList.getMessages2', chatId, startMessageIdIndex, endMessageIdIndex)
    log.debug(`_loadPageWithFirstMessage: pageMessages: ${JSON.stringify(pageMessages)}`)

    const pageKey = `page-${startMessageIdIndex}-${endMessageIdIndex}`
    
    return {
      pages: {
        [pageKey]: {
          firstMessageIdIndex: startMessageIdIndex,
          lastMessageIdIndex: endMessageIdIndex,
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
