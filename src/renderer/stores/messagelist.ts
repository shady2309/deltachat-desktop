import { C } from 'deltachat-node/dist/constants'
import { getLogger } from '../../shared/logger'
import { MessageType, MessageState, Message } from '../../shared/shared-types'
import { DeltaBackend, sendMessageParams } from '../delta-remote'
import { ipcBackend } from '../ipc'
import Store, {
  Action,
  OnlyDispatchIfCurrentlyDispatchedCounterEqualsZero,
} from './store2'

export const PAGE_SIZE = 20

export type MessageId = number
const log = getLogger('renderer/stores/MessageListStore')

export type MessageIds = Array<MessageId>

export class MessageListPage {
  messageIds: MessageIds
  messages: MessageType[]
  firstMessageIdIndex: number
  lastMessageIdIndex: number
  key: string
}

export interface PageStoreState {
  pages: { [key: string]: MessageListPage }
  pageOrdering: string[]
  chatId: number
  messageIds: MessageId[]
  marker1MessageId: number
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
    marker1MessageCount: 0,
  }
}

export interface DispatchAfter {
  action: Action
  isLayoutEffect: boolean
}
export type DispatchesAfter = DispatchAfter[]

export class PageStore extends Store<PageStoreState> {
  public currentlyLoadingPage = false
  updatePage(pageKey: string, updateObj: Partial<PageStoreState['pages']>) {
    return {
      ...this.state,
      pages: {
        ...this.state.pages,
        [pageKey]: {
          ...this.state.pages[pageKey],
          ...updateObj,
        },
      },
    }
  }

  dispatchAfter(dispatchAfter: DispatchAfter) {
    dispatchAfter.isLayoutEffect
      ? this.pushLayoutEffect(dispatchAfter.action)
      : this.pushEffect(dispatchAfter.action)
  }

  dispatchesAfter(dispatchesAfter: DispatchesAfter) {
    if (!dispatchesAfter) return
    dispatchesAfter.forEach(this.dispatchAfter.bind(this))
  }

  selectChat(chatId: number) {
    return this.dispatch(
      'selectChat',
      async (state: PageStoreState, setState) => {
        const unreadMessageIds = await DeltaBackend.call(
          'messageList.getUnreadMessageIds',
          chatId
        )
        const firstUnreadMessageId =
          unreadMessageIds.length > 0 ? unreadMessageIds[0] : -1
        const marker1MessageId = firstUnreadMessageId || 0
        const marker1MessageCount = unreadMessageIds.length

        const messageIds = await DeltaBackend.call(
          'messageList.getMessageIds',
          chatId,
          marker1MessageId
        )

        let [pages, pageOrdering]: [
          PageStoreState['pages'],
          PageStoreState['pageOrdering']
        ] = [{}, []]

        if (firstUnreadMessageId !== -1) {
          const firstUnreadMessageIdIndex = Math.max(
            0,
            messageIds.indexOf(firstUnreadMessageId)
          )
          const [
            firstMessageIdIndex,
            lastMessageIdIndex,
          ] = this._calculateIndexesForPageWithMessageIdInMiddle(
            messageIds,
            firstUnreadMessageIdIndex
          )

          const tmp = await this._loadPageWithFirstMessageIndex(
            chatId,
            messageIds,
            firstMessageIdIndex,
            lastMessageIdIndex,
            marker1MessageId
          )

          pages = tmp.pages
          pageOrdering = tmp.pageOrdering

          let messageIdIndexToFocus = Math.max(0, firstUnreadMessageIdIndex - 1)
          if (messageIds[messageIdIndexToFocus] === C.DC_MSG_ID_DAYMARKER) {
            messageIdIndexToFocus = Math.max(0, messageIdIndexToFocus - 1)
          }
          this.pushLayoutEffect({
            type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE',
            payload: {
              pageKey: pageOrdering[0],
              messageIdIndex: messageIdIndexToFocus,
            },
            id: chatId,
          })
        } else {
          const firstMessageIndexOnLastPage = Math.max(
            0,
            messageIds.length - PAGE_SIZE
          )
          const endMessageIdIndex = Math.min(
            firstMessageIndexOnLastPage + PAGE_SIZE,
            messageIds.length - 1
          )
          const tmp = await this._loadPageWithFirstMessageIndex(
            chatId,
            messageIds,
            firstMessageIndexOnLastPage,
            endMessageIdIndex,
            0
          )
          pages = tmp.pages
          pageOrdering = tmp.pageOrdering
          this.pushLayoutEffect({
            type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE',
            payload: {},
            id: chatId,
          })
        }

        setState({
          pages,
          pageOrdering,
          chatId,
          messageIds,
          unreadMessageIds,
          marker1MessageId,
          marker1MessageCount,
          loading: false,
        })
      }
    )
  }

  _calculateIndexesForPageWithMessageIdInMiddle(
    messageIds: number[],
    middleMessageIdIndex: number
  ): [number, number] {
    let firstMessageIdIndex = Math.max(middleMessageIdIndex - 3, 0)
    const currentDistance = middleMessageIdIndex - firstMessageIdIndex
    let remainingDistance = PAGE_SIZE - currentDistance
    const lastMessageIdIndex = Math.min(
      middleMessageIdIndex + remainingDistance,
      messageIds.length - 1
    )

    remainingDistance = lastMessageIdIndex - firstMessageIdIndex
    if (remainingDistance <= PAGE_SIZE) {
      firstMessageIdIndex = Math.max(firstMessageIdIndex - remainingDistance, 0)
    }

    return [firstMessageIdIndex, lastMessageIdIndex]
  }

  async jumpToMessage(chatId: number, messageId: number) {
    return this.dispatch(
      'jumpToMessage',
      async (state: PageStoreState, setState) => {
        log.debug(`jumpToMessage: chatId: ${chatId} messageId: ${messageId}`)
        const unreadMessageIds = await DeltaBackend.call(
          'messageList.getUnreadMessageIds',
          chatId
        )
        const marker1MessageId = unreadMessageIds[0] || 0
        const marker1MessageCount = unreadMessageIds.length
        const messageIds = await DeltaBackend.call(
          'messageList.getMessageIds',
          chatId,
          marker1MessageId
        )

        const jumpToMessageIndex = messageIds.indexOf(messageId)

        const [
          firstMessageIdIndex,
          lastMessageIdIndex,
        ] = this._calculateIndexesForPageWithMessageIdInMiddle(
          messageIds,
          jumpToMessageIndex
        )

        const {
          pages,
          pageOrdering,
        } = await this._loadPageWithFirstMessageIndex(
          chatId,
          messageIds,
          firstMessageIdIndex,
          lastMessageIdIndex,
          unreadMessageIds[0] || 0
        )

        this.pushLayoutEffect({
          type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE',
          payload: {
            pageKey: pageOrdering[0],
            messageIdIndex: jumpToMessageIndex,
          },
          id: chatId,
        })

        setState({
          pages,
          pageOrdering,
          chatId,
          messageIds,
          unreadMessageIds,
          marker1MessageId,
          marker1MessageCount,
          loading: false,
        })
      }
    )
  }

  async loadPageBefore(
    chatId: number,
    withoutPages: string[],
    dispatchesAfter?: DispatchesAfter
  ) {
    return this.dispatch(
      'loadPageBefore',
      async (state: PageStoreState, setState) => {
        if (chatId !== state.chatId) {
          log.debug(
            `loadPageBefore: chatId ${chatId} doesn't match with state.chatId ${state.chatId} returning`
          )
          return
        }

        const firstPage = state.pages[state.pageOrdering[0]]

        if (!firstPage) {
          log.debug('loadPageBefore: firstPage is null, returning')
          return
        }

        const firstMessageIdIndexOnFirstPage = firstPage.firstMessageIdIndex

        const firstMessageIdIndexOnPageBefore = Math.max(
          0,
          firstMessageIdIndexOnFirstPage - PAGE_SIZE
        )

        if (
          firstMessageIdIndexOnPageBefore === firstMessageIdIndexOnFirstPage
        ) {
          log.debug('loadPageBefore: no more messages, returning')
          return
        }

        const lastMessageIndexOnPageBefore = Math.min(
          firstMessageIdIndexOnFirstPage + PAGE_SIZE,
          firstPage.firstMessageIdIndex - 1
        )
        const tmp = await this._loadPageWithFirstMessageIndex(
          state.chatId,
          state.messageIds,
          firstMessageIdIndexOnPageBefore,
          lastMessageIndexOnPageBefore,
          this.state.unreadMessageIds[0] || 0
        )

        const modifiedState = this._withoutPages(this.state, withoutPages)

        this.dispatchesAfter(dispatchesAfter)
        setState({
          ...modifiedState,
          pageOrdering: [...tmp.pageOrdering, ...modifiedState.pageOrdering],
          pages: {
            ...modifiedState.pages,
            ...tmp.pages,
          },
        })
      },
      OnlyDispatchIfCurrentlyDispatchedCounterEqualsZero
    )
  }

  canLoadPageBefore(pageKey: string) {
    return this.state.pages[pageKey].firstMessageIdIndex > 0
  }

  canLoadPageAfter(pageKey: string) {
    return (
      this.state.pages[pageKey].lastMessageIdIndex <
      this.state.messageIds.length - 1
    )
  }

  async loadPageAfter(
    chatId: number,
    withoutPages: string[],
    dispatchesAfter?: DispatchesAfter
  ) {
    return this.dispatch(
      'loadPageAfter',
      async (state: PageStoreState, setState) => {
        if (chatId !== state.chatId) {
          log.debug(
            `loadPageAfter: chatId ${chatId} doesn't match with state.chatId ${state.chatId} returning`
          )
          return
        }

        const lastPage =
          state.pages[state.pageOrdering[state.pageOrdering.length - 1]]

        if (!lastPage) {
          log.debug('loadPageAfter: lastPage is null, returning')
          return
        }

        const lastMessageIdIndexOnLastPage = lastPage.lastMessageIdIndex

        const firstMessageIdIndexOnPageAfter = Math.min(
          state.messageIds.length - 1,
          lastMessageIdIndexOnLastPage + 1
        )

        if (firstMessageIdIndexOnPageAfter === lastMessageIdIndexOnLastPage) {
          log.debug('loadPageAfter: no more messages, returning')
          return
        }

        const lastMessageIndexOnPageAfter = Math.min(
          firstMessageIdIndexOnPageAfter + PAGE_SIZE,
          state.messageIds.length - 1
        )
        log.debug(
          `loadPageAfter: loading page with firstMessageIdIndexOnPageAfter: ${firstMessageIdIndexOnPageAfter} lastMessageIndexOnPageAfter: ${lastMessageIndexOnPageAfter}`
        )

        const tmp = await this._loadPageWithFirstMessageIndex(
          state.chatId,
          state.messageIds,
          firstMessageIdIndexOnPageAfter,
          lastMessageIndexOnPageAfter,
          this.state.unreadMessageIds[0] || 0
        )

        const modifiedState = this._withoutPages(this.state, withoutPages)

        this.dispatchesAfter(dispatchesAfter)
        setState({
          ...modifiedState,
          pageOrdering: [...modifiedState.pageOrdering, ...tmp.pageOrdering],
          pages: {
            ...modifiedState.pages,
            ...tmp.pages,
          },
        })
      },
      OnlyDispatchIfCurrentlyDispatchedCounterEqualsZero
    )
  }

  async _loadPageWithFirstMessageIndex(
    chatId: number,
    messageIds: number[],
    startMessageIdIndex: number,
    endMessageIdIndex: number,
    marker1Before: number
  ): Promise<{
    pages: PageStoreState['pages']
    pageOrdering: PageStoreState['pageOrdering']
  }> {
    if (
      startMessageIdIndex < 0 ||
      startMessageIdIndex >= messageIds.length ||
      endMessageIdIndex < startMessageIdIndex ||
      endMessageIdIndex >= messageIds.length
    ) {
      throw new Error(
        `_loadPageWithFirstMessage: pageFirstMessageIdIndex out of bound, returning startMessageIdIndex: ${startMessageIdIndex} endMessageIdIndex: ${endMessageIdIndex}`
      )
    }
    const messageId = messageIds[startMessageIdIndex]

    if (startMessageIdIndex === -1) {
      throw new Error(
        `_loadPageWithFirstMessage: messageId ${messageId} is not in messageIds`
      )
    }

    const pageMessageIds = messageIds.slice(
      startMessageIdIndex,
      endMessageIdIndex + 1
    )

    const pageMessages = await DeltaBackend.call(
      'messageList.getMessages',
      chatId,
      startMessageIdIndex,
      endMessageIdIndex,
      marker1Before
    )

    const pageKey = `page-${startMessageIdIndex}-${endMessageIdIndex}`

    return {
      pages: {
        [pageKey]: {
          firstMessageIdIndex: startMessageIdIndex,
          lastMessageIdIndex: endMessageIdIndex,
          messageIds: pageMessageIds,
          messages: pageMessages,
          key: pageKey,
        },
      },
      pageOrdering: [pageKey],
    }
  }

  removePage(pageKey: string) {
    this.dispatch('removePage', async (state, setState) => {
      setState(this._withoutPages(state, [pageKey]))
    })
  }

  _withoutPages(
    state: PageStoreState,
    withoutPageKeys: string[]
  ): PageStoreState {
    const pages: Partial<PageStoreState['pages']> = {}
    const pageOrdering: Partial<PageStoreState['pageOrdering']> = []

    let modified = false
    for (const pageKey of state.pageOrdering) {
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
      pages,
    }
  }

  sendMessage(chatId: number, messageParams: sendMessageParams) {
    this.dispatch('sendMessage', async (state, _setState) => {
      const [messageId, _message] = await DeltaBackend.call(
        'messageList.sendMessage',
        chatId,
        messageParams
      )

      if (chatId !== state.chatId) return

      if (messageId === 0) {
        // Workaround for failed messages
        return
      }

      const messageIds = await DeltaBackend.call(
        'messageList.getMessageIds',
        chatId
      )

      const lastMessageIndex = messageIds.length - 1
      const firstMessageIndex = Math.max(lastMessageIndex - PAGE_SIZE, 0)

      MessageListStore.refresh(chatId, messageIds, firstMessageIndex, [
        {
          action: {
            type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE',
            payload: null,
            id: state.chatId,
          },
          isLayoutEffect: true,
        },
      ])
    })
  }

  _indexOfMessageId(
    state: PageStoreState,
    messageId: number,
    iterateFromback?: boolean
  ): number {
    iterateFromback = iterateFromback === true
    const messageIdsLength = state.messageIds.length
    for (
      let i = iterateFromback ? messageIdsLength - 1 : 0;
      iterateFromback ? i >= 0 : i < messageIdsLength;
      iterateFromback ? i-- : i++
    ) {
      if (state.messageIds[i] === messageId) {
        return i
      }
    }
    return -1
  }

  _findPageWithMessageId(
    state: PageStoreState,
    messageId: number,
    iterateFromback?: boolean
  ): {
    pageKey: string
    indexOnPage: number
    messageIdIndex: number
    messageKey: string
  } {
    const messageIdIndex = this._indexOfMessageId(
      state,
      messageId,
      iterateFromback
    )

    return this._findPageWithMessageIndex(state, messageIdIndex)
  }

  _findPageWithMessageIndex(
    state: PageStoreState,
    messageIdIndex: number
  ): {
    pageKey: string
    indexOnPage: number
    messageIdIndex: number
    messageKey: string
  } {
    let pageKey: string = null
    let indexOnPage = -1

    const messageId = state.messageIds[messageIdIndex]
    if (messageIdIndex !== -1) {
      for (const currentPageKey of state.pageOrdering) {
        const currentPage = state.pages[currentPageKey]
        if (
          messageIdIndex >= currentPage.firstMessageIdIndex &&
          messageIdIndex <= currentPage.lastMessageIdIndex
        ) {
          pageKey = currentPageKey
          indexOnPage = messageIdIndex - currentPage.firstMessageIdIndex
          break
        }
      }
    }

    return {
      pageKey,
      indexOnPage,
      messageIdIndex,
      messageKey: calculateMessageKey(pageKey, messageId, messageIdIndex),
    }
  }

  _updateMessage(
    state: PageStoreState,
    pageKey: string,
    indexOnPage: number,
    updatedMessage: MessageType
  ): PageStoreState {
    return {
      ...state,
      pages: {
        ...state.pages,
        [pageKey]: {
          ...state.pages[pageKey],
          messages: [
            ...state.pages[pageKey].messages.slice(0, indexOnPage),
            updatedMessage,
            ...state.pages[pageKey].messages.slice(indexOnPage + 1),
          ],
        },
      },
    }
  }

  refresh(
    chatId: number,
    messageIds: number[],
    firstMessageOnScreenIndex: number,
    relativeScrollPosition: number,
  ) {
    this.dispatch(
      'refresh',
      async (state, setState, yourIncrementingDispatchedCounter) => {
        if (chatId !== state.chatId) {
          log.debug(
            `refresh: chatId doesn't equal currently selected chat. Returning.`
          )
          return
        }

        if (
          yourIncrementingDispatchedCounter !==
          this.incrementingDispatchedCounter
        ) {
          log.debug(`refresh: dispatchedCounter incremented, returning`)
          return
        }

        const unreadMessageIds = await DeltaBackend.call(
          'messageList.getUnreadMessageIds',
          chatId
        )
        const firstUnreadMessageId =
          unreadMessageIds.length > 0 ? unreadMessageIds[0] : -1
        const marker1MessageId = firstUnreadMessageId || 0
        const marker1MessageCount = unreadMessageIds.length

        if (
          yourIncrementingDispatchedCounter !==
          this.incrementingDispatchedCounter
        ) {
          log.debug(`refresh: dispatchedCounter incremented, returning`)
          return
        }

        const [firstMessageIndex, lastMessageIndex] = this._calculateIndexesForPageWithMessageIdInMiddle(
          messageIds, firstMessageOnScreenIndex
        )
        
        const {
          pages,
          pageOrdering,
        } = await this._loadPageWithFirstMessageIndex(
          chatId,
          messageIds,
          firstMessageIndex,
          lastMessageIndex,
          marker1MessageId
        )

        if (
          yourIncrementingDispatchedCounter !==
          this.incrementingDispatchedCounter
        ) {
          log.debug(`refresh: dispatchedCounter incremented, returning`)
          return
        }

        const newState = {
          pages,
          pageOrdering,
          chatId,
          messageIds,
          unreadMessageIds,
          marker1MessageId,
          marker1MessageCount,
          loading: false,
        }

        const {messageKey} = this._findPageWithMessageIndex(newState, firstMessageOnScreenIndex)
        this.pushLayoutEffect({
          type: 'SCROLL_TO_MESSAGE',
          payload: {
            messageKey,
            relativeScrollPosition
          },
          id: state.chatId
        })
        setState(newState)
      }
    )
  }
  onMessageDelivered(chatId: number, messageId: number) {
    this.dispatch('onMessageDelivered', async (state, setState) => {
      if (chatId !== state.chatId) {
        log.debug(
          `onMessageDelivered: chatId doesn't equal currently selected chat. Returning.`
        )
        return
      }
      const { pageKey, indexOnPage } = this._findPageWithMessageId(
        state,
        messageId,
        true
      )

      if (pageKey === null) {
        log.debug(
          `onMessageDelivered: Couldn't find messageId in any shown pages. Returning`
        )
        return
      }

      const message = state.pages[pageKey].messages[indexOnPage]

      setState(
        this._updateMessage(state, pageKey, indexOnPage, {
          ...message,
          state: MessageState.OUT_DELIVERED,
        } as Message)
      )
    })
  }

  onMessageFailed(chatId: number, messageId: number) {
    this.dispatch('onMessageFailed', async (state, setState) => {
      if (chatId !== state.chatId) {
        log.debug(
          `onMessageFailed: chatId doesn't equal currently selected chat. Returning.`
        )
        return
      }
      const { pageKey, indexOnPage } = this._findPageWithMessageId(
        state,
        messageId,
        true
      )

      if (pageKey === null) {
        log.debug(
          `onMessageFailed: Couldn't find messageId in any shown pages. Returning`
        )
        return
      }

      const message = state.pages[pageKey].messages[indexOnPage]

      setState(
        this._updateMessage(state, pageKey, indexOnPage, {
          ...message,
          state: MessageState.OUT_FAILED,
        } as Message)
      )
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
      const { pageKey, indexOnPage } = this._findPageWithMessageId(
        state,
        messageId,
        true
      )

      if (pageKey === null) {
        log.debug(
          `onMessageRead: Couldn't find messageId in any shown pages. Returning`
        )
        return
      }

      const message = state.pages[pageKey].messages[indexOnPage]

      setState(
        this._updateMessage(state, pageKey, indexOnPage, {
          ...message,
          state: MessageState.OUT_MDN_RCVD,
        } as Message)
      )
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
        `markMessagesSeen: chatId:(${chatId}) messageIds: ${JSON.stringify(
          messageIds
        )} unreadMessageIds: ${JSON.stringify(state.unreadMessageIds)}`
      )

      const markSeen = DeltaBackend.call(
        'messageList.markSeenMessages',
        messageIds
      )

      let update = false
      for (const messageId of messageIds) {
        const { pageKey } = this._findPageWithMessageId(state, messageId, true)
        if (pageKey === null) {
          log.debug(
            `markMessagesSeen: Couldn't find messageId in any shown pages. Returning`
          )
          continue
        }

        update = true
      }

      if (update) {
        await markSeen
        // Use this.state as it's possible that things changed during the await
        setState({
          ...this.state,
          unreadMessageIds: this.state.unreadMessageIds.filter(
            mId => messageIds.indexOf(mId) === -1
          ),
        })
      }
    })
  }

  onMessagesChanged(chatId: number, messageId: number) {
    this.dispatch('onMessagesChanged', async (_state, _setState) => {
      log.debug(`onMessagesChanged: chatId: ${chatId} messageId: ${messageId}`)
      //this.pushLayoutEffect({type:'INCOMING_MESSAGES', payload: messageIdsIncoming.length, id: chatId})
    })
  }

  deleteMessage(messageId: number) {
    this.dispatch('deleteMessage', async (_state, _setState) => {
      log.debug(`deleteMessage: deleting message with id ${messageId}`)
      DeltaBackend.call('messageList.deleteMessage', messageId)
    })
  }

  init() {
    ipcBackend.on('DC_EVENT_MSG_DELIVERED', (_evt, [chatId, messageId]) => {
      this.onMessageDelivered(chatId, messageId)
    })

    ipcBackend.on('DC_EVENT_MSG_FAILED', (_evt, [chatId, messageId]) => {
      this.onMessageFailed(chatId, messageId)
    })

    ipcBackend.on('DC_EVENT_MSG_READ', (_, [chatId, messageId]) => {
      this.onMessageRead(chatId, messageId)
    })
  }
}

export const MessageListStore = new PageStore(
  defaultPageStoreState(),
  'MessageListStore'
)

export function calculateMessageKey(
  pageKey: string,
  messageId: number,
  messageIndex: number
): string {
  return pageKey + '-' + messageId + '-' + messageIndex
}

export function parseMessageKey(
  messageKey: string
): {
  pageKey: string
  messageId: number
  messageIndex: number
} {
  const splittedMessageKey = messageKey.split('-')
  if (splittedMessageKey[0] !== 'page' && splittedMessageKey.length === 5) {
    throw new Error('Expected a proper messageKey')
  }
  return {
    pageKey: `page-${splittedMessageKey[1]}-${splittedMessageKey[2]}`,
    messageId: Number.parseInt(splittedMessageKey[3]),
    messageIndex: Number.parseInt(splittedMessageKey[4]),
  }
}
