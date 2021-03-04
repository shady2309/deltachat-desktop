import { getLogger } from "../../shared/logger"
import { MessageType } from "../../shared/shared-types"
import { DeltaBackend } from "../delta-remote"
import { PAGE_SIZE } from "./chat"
import { Store } from "./store2"

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

export class PageStore extends Store<PageStoreState> {
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

  selectChat(chatId: number) {
    return this.dispatch('selectChat', async (state: PageStoreState) => {
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)

      return {
        pages: {},
        pageOrdering: [],
        chatId,
        messageIds,
        loading: false
      }
    })
  }
  
  loadPageWithFirstMessage(messageId: number) {
    return this.dispatch('loadPageWithFirstMessage', async (state: PageStoreState) => {
      if (state.loading === true) {
        log.warn(`LOAD_PAGE_FROM_MESSAGE_ID: We are already loading something, bailing out`)
        return
      }
      this.setState(state => {return {...state, loading: true}})

      const pageFirstMessageIdIndex = state.messageIds.indexOf(messageId)

      if (pageFirstMessageIdIndex === -1) {
        log.warn(`LOAD_PAGE_FROM_MESSAGE_ID: messageId ${messageId} is not in messageIds`)
      }
      
      const pageMessageIds = state.messageIds.slice(pageFirstMessageIdIndex, pageFirstMessageIdIndex + PAGE_SIZE);
      const pageLastMessageIdIndex = pageFirstMessageIdIndex + pageMessageIds.length - 1
      
      const pageMessages = await DeltaBackend.call('messageList.getMessages', pageMessageIds)

      const pageKey = `page-${pageFirstMessageIdIndex}-${pageLastMessageIdIndex}
      `
      return {
        ...state,
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
        loading: false			
      }
    })
  }
}

export const MessageListStore = new PageStore(defaultPageStoreState(), 'MessageListPageStore');
