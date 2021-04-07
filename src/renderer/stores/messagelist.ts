import { getLogger } from "../../shared/logger"
import { Message2, MessageType } from "../../shared/shared-types"
import { DeltaBackend, sendMessageParams } from "../delta-remote"
import { ipcBackend } from "../ipc"
import { PAGE_SIZE } from "./chat"
import { Action, Store } from "./store2"

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
  unreadMessageIds: number[]
	loading: boolean
}

export function defaultPageStoreState(): PageStoreState {
	return {
		pages: {},
		pageOrdering: [],
		chatId: -1,
		messageIds: [],
    unreadMessageIds: [],
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
      
      const unreadMessageIds = await DeltaBackend.call('messageList.getUnreadMessageIds', chatId)
      const firstUnreadMessageId = unreadMessageIds.length > 0 ? unreadMessageIds[0] : -1

      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId, firstUnreadMessageId === -1 ? 0 : firstUnreadMessageId)

      let [pages, pageOrdering]: [PageStoreState['pages'], PageStoreState['pageOrdering']] = [{}, []]

      if (firstUnreadMessageId !== -1) {
        const firstUnreadMessageIdIndex = Math.max(0, messageIds.indexOf(firstUnreadMessageId) - 1)

        const [firstMessageIdIndex, lastMessageIdIndex] = this._calculateIndexesForPageWithMessageIdInMiddle(messageIds, firstUnreadMessageIdIndex)
        
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIdIndex, lastMessageIdIndex, firstUnreadMessageId|| 0)
        
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0], messageIdIndex: firstUnreadMessageIdIndex}, id: chatId}) 
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - PAGE_SIZE)
        const endMessageIdIndex = Math.min(firstMessageIndexOnLastPage + PAGE_SIZE, messageIds.length - 1)
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIndexOnLastPage, endMessageIdIndex, unreadMessageIds[0] || 0)
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        this.pushLayoutEffect({type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {}, id: chatId})
      }
      
      
      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        unreadMessageIds,
        loading: false
      })
    })
  }
  
  _calculateIndexesForPageWithMessageIdInMiddle(messageIds: number[], middleMessageIdIndex: number) {
    const half_page_size = PAGE_SIZE / 2
    const firstMessageIdIndex = Math.max(middleMessageIdIndex - half_page_size, 0)
    const currentDistance = middleMessageIdIndex - firstMessageIdIndex
    const remainingDistance = PAGE_SIZE - currentDistance
    const lastMessageIdIndex = Math.min(middleMessageIdIndex + remainingDistance, messageIds.length - 1)

    return [firstMessageIdIndex, lastMessageIdIndex]
  }
  
  async jumpToMessage(chatId: number, messageId: number) {
    return this.dispatch('jumpToMessage', async (state: PageStoreState, setState) => {
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)
      const unreadMessageIds = await DeltaBackend.call('messageList.getUnreadMessageIds', chatId)
      log.debug(`jumpToMessage: chatId: ${chatId} messageId: ${messageId}`)
      const jumpToMessageIndex = messageIds.indexOf(messageId)


      const [firstMessageIdIndex, lastMessageIdIndex] = this._calculateIndexesForPageWithMessageIdInMiddle(messageIds, jumpToMessageIndex)
      let {pages, pageOrdering} = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIdIndex, lastMessageIdIndex, unreadMessageIds[0] || 0)
      
      this.pushLayoutEffect({type: 'SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0]}, id: chatId})
      
      
      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        unreadMessageIds,
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
      const tmp = await this._loadPageWithFirstMessageIndex(state.chatId, state.messageIds, firstMessageIdIndexOnPageBefore, lastMessageIndexOnPageBefore, this.state.unreadMessageIds[0] || 0)  


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
      log.debug(`loadPageAfter: loading page with firstMessageIdIndexOnPageAfter: ${firstMessageIdIndexOnPageAfter} lastMessageIndexOnPageAfter: ${lastMessageIndexOnPageAfter}`)

      const tmp = await this._loadPageWithFirstMessageIndex(state.chatId, state.messageIds, firstMessageIdIndexOnPageAfter, lastMessageIndexOnPageAfter, this.state.unreadMessageIds[0] || 0)
      
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
  async _loadPageWithFirstMessageIndex(chatId: number, messageIds: number[], startMessageIdIndex: number, endMessageIdIndex: number, marker1Before: number) : Promise<{pages: PageStoreState['pages'], pageOrdering: PageStoreState['pageOrdering']}> {
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
    
    const pageMessages = await DeltaBackend.call('messageList.getMessages', chatId, startMessageIdIndex, endMessageIdIndex, marker1Before)

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
  
  sendMessage(chatId: number, messageParams: sendMessageParams) {
    this.dispatch('sendMessage', async (state, setState) => {
      const [messageId, message] = await DeltaBackend.call(
        'messageList.sendMessage',
        chatId,
        messageParams
      )
      // Workaround for failed messages
      if (messageId === 0) return
        
      const messageIdIndex = state.messageIds.length

      const pageKey = `page-${messageId}-${messageId}`
      
      this.pushLayoutEffect({type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: null, id: state.chatId})
      state = this.state
      setState({
        ...state,
        pageOrdering: [...state.pageOrdering, pageKey],
        messageIds: [...state.messageIds, messageId],
        pages: {
          ...state.pages,
          [pageKey]: {
            messageIds: [messageId],
            messages: [message],
            firstMessageIdIndex: messageIdIndex,
            lastMessageIdIndex: messageIdIndex,
            key: pageKey
          }
          
        }
      })
    })
  }
  
  _indexOfMessageId(state: PageStoreState, messageId: number, iterateFromback?: boolean): number {
    iterateFromback = iterateFromback === true
    const messageIdsLength = state.messageIds.length
    for (let i = iterateFromback ? messageIdsLength - 1 : 0; iterateFromback ? i >= 0 : i < messageIdsLength; iterateFromback ? i-- : i++) {
      if (state.messageIds[i] === messageId) {
        return i
      }
    }
    return -1

  }

  _findPageWithMessageId(state: PageStoreState, messageId: number, iterateFromback?: boolean): [string, number] {
    let pageKey: string = null
    let indexOnPage: number = -1
    
    const messageIdIndex = this._indexOfMessageId(state, messageId, iterateFromback)
    if (messageIdIndex === -1) {
      return [pageKey, indexOnPage]
    }

    for (const currentPageKey of state.pageOrdering) {
      const currentPage = state.pages[currentPageKey]
      if (messageIdIndex >= currentPage.firstMessageIdIndex && messageIdIndex <= currentPage.lastMessageIdIndex) {
        pageKey = currentPageKey
        indexOnPage = currentPage.messageIds.indexOf(messageId)
        break
      }
    }

    return [pageKey, indexOnPage]
  }
  
  _updateMessage(state: PageStoreState, pageKey: string, indexOnPage: number, updatedMessage: Message2): PageStoreState {
    return  {
      ...state,
      pages: {
        ...state.pages,
        [pageKey]: {
          ...state.pages[pageKey],
          messages: [
            ...state.pages[pageKey].messages.slice(0, indexOnPage),
            updatedMessage,
            ...state.pages[pageKey].messages.slice(indexOnPage)
          ]
        }
      }
    }
  }
  
  onMessageDelivered(chatId: number, messageId: number) {
    this.dispatch('onMessageDelivered', async (state, setState) => {
      if (chatId !== state.chatId) {
        log.debug(`onMessageDelivered: chatId doesn't equal currently selected chat. Returning.`)
        return

      }
      const [pageKey, indexOnPage] = this._findPageWithMessageId(state, messageId, true)

      if(pageKey === null) {
        log.debug(`onMessageDelivered: Couldn't find messageId in any shown pages. Returning`)
        return
      }
      
      const message = state.pages[pageKey].messages[indexOnPage]

      
      setState(this._updateMessage(state, pageKey, indexOnPage, {
        ...message,
        message: {
          ...message.message,
          msg: {
            ...(message.message as MessageType).msg,
            status: 'delivered'
          }
        }
      }))
    })
  }
  
  onMessageFailed(chatId: number, messageId: number) {
    this.dispatch('onMessageFailed', async (state, setState) => {
      if (chatId !== state.chatId) {
        log.debug(`onMessageFailed: chatId doesn't equal currently selected chat. Returning.`)
        return
        
      }
      const [pageKey, indexOnPage] = this._findPageWithMessageId(state, messageId, true)

      if(pageKey === null) {
        log.debug(`onMessageFailed: Couldn't find messageId in any shown pages. Returning`)
        return
      }
      
      const message = state.pages[pageKey].messages[indexOnPage]
      
      
      setState(this._updateMessage(state, pageKey, indexOnPage, {
        ...message,
        message: {
          ...message.message,
          msg: {
            ...(message.message as MessageType).msg,
            status: 'error'
          }
        }
      }))
    })
  }

  onIncomingMessage(chatId: number) {
    this.dispatch('onIncomingMessage', async (state, setState) => {

      if (chatId !== state.chatId) {
        log.debug(
          `onIncomingMessage: chatId of event (${chatId}) doesn't match id of selected chat (${state.chatId}). Returning.`
        )
        return
      }
      

      const messageIds = <number[]>(
        await DeltaBackend.call('messageList.getMessageIds', chatId)
      )
      
      const messageIdsIncoming = messageIds.filter(
        x => !state.messageIds.includes(x)
      )
      
      this.pushLayoutEffect({type:'INCOMING_MESSAGES', payload: messageIdsIncoming.length, id: chatId})
      
      setState({
        ...state,
        messageIds
      })
    })
  }

  onMessageRead(chatId: number, messageId: number) {
    this.dispatch('onMessageRead', async (state, setState) => {
      if (chatId !== state.chatId) {
        log.debug(
          `onMessageRead: chatId of event (${chatId}) doesn't match id of selected chat (${state.chatId}). Returning.`
        )
        return
      }
      const [pageKey, indexOnPage] = this._findPageWithMessageId(state, messageId, true)

      if(pageKey === null) {
        log.debug(`onMessageRead: Couldn't find messageId in any shown pages. Returning`)
        return
      }
      
      const message = state.pages[pageKey].messages[indexOnPage]
      
      
      setState(this._updateMessage(state, pageKey, indexOnPage, {
        ...message,
        message: {
          ...message.message,
          msg: {
            ...(message.message as MessageType).msg,
            status: 'read'
          }
        }
      }))
    })
  }
  

  init() {
    ipcBackend.on('DC_EVENT_MSG_DELIVERED', (_evt, [chatId, messageId]) => {
      this.onMessageDelivered(chatId, messageId)
    })

    ipcBackend.on('DC_EVENT_MSG_FAILED', (_evt, [chatId, messageId]) => {
      this.onMessageFailed(chatId, messageId)
    })

    ipcBackend.on('DC_EVENT_INCOMING_MSG', (_, [chatId, _messageId]) => {
      this.onIncomingMessage(chatId)
    })
    
    ipcBackend.on('DC_EVENT_MSG_READ', (_, [chatId, messageId]) => {
      this.onMessageRead(chatId, messageId)
    })
  }
}

export const MessageListStore = new PageStore(defaultPageStoreState(), 'MessageListStore');
