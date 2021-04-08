import { C } from "deltachat-node/dist/constants"
import { getLogger } from "../../shared/logger"
import { Message2, MessageState, MessageType } from "../../shared/shared-types"
import { DeltaBackend, sendMessageParams } from "../delta-remote"
import { ipcBackend } from "../ipc"
import { Action, Store } from "./store2"
 
export const PAGE_SIZE = 20

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
  marker1MessageId: number,
  marker1MessageCount: number
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
    marker1MessageId: 0,
    marker1MessageCount: 0
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
      const marker1MessageId = firstUnreadMessageId || 0
      const marker1MessageCount = unreadMessageIds.length

      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId, marker1MessageId)

      let [pages, pageOrdering]: [PageStoreState['pages'], PageStoreState['pageOrdering']] = [{}, []]

      if (firstUnreadMessageId !== -1) {
        const firstUnreadMessageIdIndex = Math.max(0, messageIds.indexOf(firstUnreadMessageId))
        const [firstMessageIdIndex, lastMessageIdIndex] = this._calculateIndexesForPageWithMessageIdInMiddle(messageIds, firstUnreadMessageIdIndex)
        
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIdIndex, lastMessageIdIndex, marker1MessageId)
        
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
        
        let messageIdIndexToFocus = Math.max(0, firstUnreadMessageIdIndex - 1)
        if (messageIds[messageIdIndexToFocus] === C.DC_MSG_ID_DAYMARKER) {
          messageIdIndexToFocus = Math.max(0, messageIdIndexToFocus - 1)
        }
        this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0], messageIdIndex: messageIdIndexToFocus}, id: chatId}) 
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - PAGE_SIZE)
        const endMessageIdIndex = Math.min(firstMessageIndexOnLastPage + PAGE_SIZE, messageIds.length - 1)
        let tmp = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIndexOnLastPage, endMessageIdIndex, 0)
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
        marker1MessageId,
        marker1MessageCount,
        loading: false
      })
    })
  }
  
  _calculateIndexesForPageWithMessageIdInMiddle(messageIds: number[], middleMessageIdIndex: number) {
    let firstMessageIdIndex = Math.max(middleMessageIdIndex - 3, 0)
    const currentDistance = middleMessageIdIndex - firstMessageIdIndex
    let remainingDistance = PAGE_SIZE - currentDistance
    const lastMessageIdIndex = Math.min(middleMessageIdIndex + remainingDistance, messageIds.length - 1)
  
    remainingDistance = lastMessageIdIndex - firstMessageIdIndex
    if (remainingDistance <= PAGE_SIZE) {
      firstMessageIdIndex = Math.max(firstMessageIdIndex - remainingDistance, 0)
    }

    return [firstMessageIdIndex, lastMessageIdIndex]
  }
  
  async jumpToMessage(chatId: number, messageId: number) {
    return this.dispatch('jumpToMessage', async (state: PageStoreState, setState) => {
      log.debug(`jumpToMessage: chatId: ${chatId} messageId: ${messageId}`)
      const unreadMessageIds = await DeltaBackend.call('messageList.getUnreadMessageIds', chatId)
      const marker1MessageId = unreadMessageIds[0] || 0
      const marker1MessageCount = unreadMessageIds.length
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId, marker1MessageId)
      
      const jumpToMessageIndex = messageIds.indexOf(messageId)


      const [firstMessageIdIndex, lastMessageIdIndex] = this._calculateIndexesForPageWithMessageIdInMiddle(messageIds, jumpToMessageIndex)
      
      let {pages, pageOrdering} = await this._loadPageWithFirstMessageIndex(chatId, messageIds, firstMessageIdIndex, lastMessageIdIndex, unreadMessageIds[0] || 0)
      
      this.pushLayoutEffect({type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {pageKey: pageOrdering[0], messageIdIndex: jumpToMessageIndex}, id: chatId}) 

      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        unreadMessageIds,
        marker1MessageId,
        marker1MessageCount,
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

  canLoadPageBefore(pageKey: string) {
    return this.state.pages[pageKey].firstMessageIdIndex > 0
  }

  canLoadPageAfter(pageKey: string) {
    return this.state.pages[pageKey].lastMessageIdIndex < (this.state.messageIds.length - 1)
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
  
  isCurrentlyLoadingPage() {
    return this.currentlyLoadingPage
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
            state: C.DC_STATE_OUT_DELIVERED as MessageState
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
            state: C.DC_STATE_OUT_FAILED as MessageState
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
            state: C.DC_STATE_OUT_MDN_RCVD as MessageState
          }
        }
      }))
    })
  }
  
  markMessagesSeen(chatId: number, messageIds: number[]) {
    this.dispatch('markMessagesSeen', async (state, setState) => {

      if (chatId !== state.chatId) {
        log.debug(
          `markMessagesSeen: chatId of event (${chatId}) doesn't match id of selected chat (${state.chatId}). Returning.`
        )
        return
      }
      log.debug(
        `markMessagesSeen: chatId:(${chatId}) messageIds: ${JSON.stringify(messageIds)} unreadMessageIds: ${JSON.stringify(state.unreadMessageIds)}`
      )

      const markSeen = DeltaBackend.call('messageList.markSeenMessages', messageIds)

      let update = false
      let updatedState = state
      for (let messageId of messageIds) {
        const [pageKey, indexOnPage] = this._findPageWithMessageId(state, messageId, true)
        console.log(messageId, pageKey, indexOnPage)

        if(pageKey === null) {
          log.debug(`markMessagesSeen: Couldn't find messageId in any shown pages. Returning`)
          continue
        }
        
        const message = state.pages[pageKey].messages[indexOnPage]
      
        /*updatedState = this._updateMessage(updatedState, pageKey, indexOnPage, {
          ...message,
          message: {
            ...message.message,
            msg: {
              ...(message.message as MessageType).msg,
              state: C.DC_STATE_IN_SEEN as MessageState
            }
          }
        })*/

        update = true
      }

      if (update) {
        await markSeen
        //updatedState.unreadMessageIds = state.unreadMessageIds.filter((value) => messageIds.indexOf(value) === -1)
        setState({
          ...state,
          unreadMessageIds: state.unreadMessageIds.filter(mId => messageIds.indexOf(mId) === -1)
        })
      }
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
