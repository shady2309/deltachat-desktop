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
        let tmp = await this._loadPageWithFirstMessage(messageIds, firstUnreadMessageId)
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {msgId: firstUnreadMessageId}, id: chatId})
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - PAGE_SIZE)
        let tmp = await this._loadPageWithFirstMessage(messageIds, messageIds[firstMessageIndexOnLastPage])
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
  

  async loadPageBefore(dispatchesAfter?: DispatchesAfter) {
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

      const tmp = await this._loadPageWithFirstMessage(state.messageIds, state.messageIds[firstMessageIdIndexOnPageBefore])

      this.dispatchesAfter(dispatchesAfter)

      setState({
        ...this.state,
        pageOrdering: [...tmp.pageOrdering, ...this.state.pageOrdering],
        pages: {
          ...this.state.pages,
          ...tmp.pages
        }
      })
    })
  }
  
  async loadPageAfter(dispatchesAfter?: DispatchesAfter) {
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

      const tmp = await this._loadPageWithFirstMessage(state.messageIds, state.messageIds[firstMessageIdIndexOnPageAfter])

      this.dispatchesAfter(dispatchesAfter)

      setState({
        ...this.state,
        pageOrdering: [...this.state.pageOrdering, ...tmp.pageOrdering],
        pages: {
          ...this.state.pages,
          ...tmp.pages
        }
      })
    })
  }
  
  doneCurrentlyLoadingPage() {
    this.currentlyLoadingPage = false
  }
  async _loadPageWithFirstMessage(messageIds: number[], messageId: number) : Promise<{pages: PageStoreState['pages'], pageOrdering: PageStoreState['pageOrdering']}> {
    const pageFirstMessageIdIndex = messageIds.indexOf(messageId)

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
      setState({
        ...state,
        pageOrdering: state.pageOrdering.filter(value => value !== pageKey),
        pages: {
          ...state.pages,
          [pageKey]: undefined
        }
      })
    })
  } 
}

export const MessageListStore = new PageStore(defaultPageStoreState(), 'MessageListPageStore');
