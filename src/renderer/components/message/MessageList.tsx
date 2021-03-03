import { ChatStoreState } from "../../stores/chat";
import React, { useEffect, useState } from 'react'
import { setRTLTextPlugin } from "mapbox-gl";
import { DeltaBackend } from "../../delta-remote";
import { MessageWrapper } from "./MessageWrapper";
import { MessageType } from "../../../shared/shared-types";
import { number } from "prop-types";
import { Store, useStore } from "../../stores/store";


export type MessageId = number

export type MessageIds = Array<MessageId>

export type Message = MessageType | { msg : null}

export interface Messages {
	[key: number]: Message
}

export class MessageListPage {
	pageMessageIds: MessageIds
	pageMessages: Messages
	firstMessageIdIndex: number
	lastMessageIdIndex: number
	pageLoading: boolean
}

export type MessageListPages = FixedSizeArray<2, MessageListPage>

export class PageStoreState {
	pages: MessageListPages
	chatId: number
	messageIds: MessageIds
	pageZeroIsAbove: boolean
}

export type FixedSizeArray<N extends number, T> = N extends 0 ? never[] : {
    0: T;
    length: N;
} & ReadonlyArray<T>;


const pageStore  = new Store<MessageListPages>([new MessageListPage(), new MessageListPage()], 'MessageListPageStore');

pageStore.attachReducer((action, state) => {
	if (action.type === 'UPDATE_PAGE') {
	    const {pageId, ...updatedProperties}  = action.payload
		
		return {
			...state,
			[pageId]: {
				...state[pageId],
				...updatedProperties
			}
		}
	}
})

pageStore.attachEffect((action, state) => {
	if (action.type === 'UPDATE_PAGE') {
		
})

export const usePageStore = () => useStore(pageStore)




export default function MessageList({
	chat,
	refComposer
} : {
	chat: ChatStoreState,
	refComposer: todo
}) {

	const [pages, pagesDispatch] = usePageStore()

	const onSelectChat = () => {
		setPages((pages) => { return {...pages, pageZero: {...pages.pageZero, loading: false}}})
		;(async () => {
			const _messageIds = await DeltaBackend.call('messageList.getMessageIds', chat.id)
			const messageIds = [_messageIds[0], _messageIds[1], _messageIds[2]]
			const messages = await DeltaBackend.call('messageList.getMessages', [messageIds[0], messageIds[1], messageIds[2]])
			console.log(messages)
			setPages((pages) => { return {...pages, pageZero: {...pages.pageZero, messageIds, messages, loading: false}}})
		})()
	}

	useEffect(onSelectChat, [])
	useEffect(onSelectChat, [chat.id])
	

	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element) => {
		return (
			<>
				<MessagePage isPageZero={true} page={pages.pageZero} mapFunction={mapFunction} />
				<MessagePage isPageZero={false} page={pages.pageOne} mapFunction={mapFunction} />
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
	  isPageZero,
	  page,
	  mapFunction
	} : {
		isPageZero: boolean,
		page: MessageListPage,
		mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element
	}) { 
		const pageNumber = isPageZero ? 0 : 1;
		return (
			<div className={'message-list-page page-' + pageNumber} key={'page-' + pageNumber}>
			  {"Is loading: " + page.loading}
			  {page.messageIds.map((_messageId) => {
				const messageId: MessageId = _messageId as MessageId 
				const message: Message = page.messages[messageId]
				const key = 'page-' + pageNumber + '-' + messageId
				return mapFunction(key, messageId, message)

			  })}
			</div>
		)
	}
