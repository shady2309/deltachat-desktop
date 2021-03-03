import { ChatStoreState, PAGE_SIZE } from "../../stores/chat";
import React, { useEffect } from 'react'
import { DeltaBackend } from "../../delta-remote";
import { MessageType } from "../../../shared/shared-types";
import { Store, useStore2 } from "../../stores/store";
import { getLogger } from "../../../shared/logger";


export type MessageId = number
const log = getLogger('renderer/message/MessageList')


export type MessageIds = Array<MessageId>

export type Message = MessageType | { msg : null}

export interface Messages {
	[key: number]: Message
}


export type MessageListPages = FixedSizeArray<2, MessageListPage>


export class MessageListPage {
	messageIds: MessageIds
	messages: Messages
	firstMessageIdIndex: number
	lastMessageIdIndex: number
	key: string
}


export class PageStoreState {
	pages: { [key:string] : MessageListPage}
	pageOrdering: string[]
	chatId: number
	messageIds: MessageId[]
	loading: boolean
}

export type FixedSizeArray<N extends number, T> = N extends 0 ? never[] : {
    0: T;
    length: N;
} & ReadonlyArray<T>;




const pageStore  = new Store<PageStoreState>(new PageStoreState(), 'MessageListPageStore');


function updatePage(state: PageStoreState, pageKey: string, updateObj: todo) {
	return {
		...state,
		pages: {
			...state.pages,
			[pageKey]: {
				...state.pages[pageKey],
				...updateObj
			}
		}
	}
}

pageStore.attachReducer((action, state) => {
	if (action.id !== state.chatId) return

	if (action.type === 'UPDATE_PAGE') {
	    const {pageId, ...updateProperties}  = action.payload
		return updatePage(state, pageId, updateProperties)
	}
})


pageStore.attachEffect(async (action, state) => {

	if (action.type === 'SELECT_CHAT') {
		const {chatId} = action.payload
		const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId)


		return {
			pages: [],
			pageOrdering: [],
			chatId,
			messageIds,
			loading: false
		}
	}

	if (action.id !== state.chatId) return
	
	if (action.type === 'LOAD_PAGE_WITH_FIRST_MESSAGE_ID') {
		if (state.loading === true) {
			log.warn(`LOAD_PAGE_FROM_MESSAGE_ID: We are already loading something, bailing out`)
			return
		}
		pageStore.setState({...state, loading: true})

		const {messageId} = action.payload
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

	}

		
})

export const usePageStore = () => useStore2(pageStore)




export default function MessageList({
	chat} : {
	chat: ChatStoreState,
	refComposer: todo
}) {

	const [pageStore, pageStoreDispatch] = usePageStore()

	const onSelectChat = () => {
		pageStoreDispatch('SELECT_CHAT', {chatId: chat.id}, null)
		pageStoreDispatch('LOAD_PAGE_WITH_FIRST_MESSAGE_ID', {messageId: pageStore.messageIds[0]}, chat.id)
	}

	useEffect(onSelectChat, [])
	useEffect(onSelectChat, [chat.id])
	

	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element) => {
		return (
			<>
				{pageStore.pageOrdering.map((pageKey: string) => {
					return <MessagePage page={pageStore.pages[pageKey]} mapFunction={mapFunction}/>
				})}
			</>
		)
	}


	return <>
		{iterateMessages((key, messageId, message) => {
			return <div className='message' key={key}>
			  key: {key}
			  messageId: {messageId}
			  message: {JSON.stringify(message)}
			</div>
		})}
	</>
}

export function MessagePage(
{ 
  page,
  mapFunction
} : {
	page: MessageListPage,
	mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element
}) { 
	return (
		<div className={'message-list-page'} key={page.key}>
		  {"Is loading: " + page}
		  {page.messageIds.map((_messageId) => {
			const messageId: MessageId = _messageId as MessageId 
			const message: Message = page.messages[messageId]
			const key = page.key + '-' + messageId
			return mapFunction(key, messageId, message)

		  })}
		</div>
	)
}
