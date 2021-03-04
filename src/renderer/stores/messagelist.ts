import { MessageState } from "deltachat-node"
import { getLogger } from "../../shared/logger"
import { MessageType } from "../../shared/shared-types"
import { DeltaBackend } from "../delta-remote"
import { PAGE_SIZE } from "./chat"
import { Store, StoreDispatchSetState } from "./store2"

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
    return this.dispatch('selectChat', async (state: PageStoreState, setState) => {
      const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)
      const firstUnreadMessageId = await DeltaBackend.call('messageList.getFirstUnreadMessageId', chatId)

      let [pages, pageOrdering]: [PageStoreState['pages'], PageStoreState['pageOrdering']] = [{}, []]

      if (firstUnreadMessageId !== -1) {
        let tmp = await this._loadPageWithFirstMessage(messageIds, firstUnreadMessageId)
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
      } else {
        let firstMessageIndexOnLastPage = Math.max(0, messageIds.length - 1 - PAGE_SIZE)
        let tmp = await this._loadPageWithFirstMessage(messageIds, messageIds[firstMessageIndexOnLastPage])
        pages = tmp.pages
        pageOrdering = tmp.pageOrdering
      }
      
      this.pushLayoutEffect({type: 'SELECTED_CHAT', payload: {firstUnreadMessageId}, id: chatId})
      
      setState({
        pages,
        pageOrdering,
        chatId,
        messageIds,
        loading: false
      })
    })
  }
  
  async _loadPageWithFirstMessage(messageIds: number[], messageId: number) : Promise<{pages: PageStoreState['pages'], pageOrdering: PageStoreState['pageOrdering']}> {
    const pageFirstMessageIdIndex = messageIds.indexOf(messageId)

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
}

export const MessageListStore = new PageStore(defaultPageStoreState(), 'MessageListPageStore');
