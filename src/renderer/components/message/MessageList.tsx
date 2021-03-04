import { ChatStoreState } from "../../stores/chat";
import React, { useEffect } from 'react'
import { MessageId, Message, MessageListPage, MessageListStore } from "../../stores/messagelist";
import { Action } from "../../stores/store2";
import { MessageWrapper } from "./MessageWrapper";
import { MessageType } from "../../../shared/shared-types";



const MessageList = React.memo(function MessageList({
}) {

	useEffect(() => { console.log('Rerendering MessageList')})
	const onMessageListStoreEffect = (action: Action) => {

	}
	const onMessageListStoreLayoutEffect = (action: Action) => {
	  if (action.type === 'SELECTED_CHAT') {
		  console.log('haaalloooo')
	  }

	}

	const messageListStore = MessageListStore.useStore(onMessageListStoreEffect, onMessageListStoreLayoutEffect)

	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element) => {
		return (
			<>
				{messageListStore.pageOrdering.map((pageKey: string) => {
					return <MessagePage page={messageListStore.pages[pageKey]} mapFunction={mapFunction}/>
				})}
			</>
		)
	}


	return <>
		{iterateMessages((key, messageId, message) => {
			console.log(key)
			if (messageId === 9) return null
			return (
		      <MessageWrapper
				key={key}
				message={message as MessageType}
				conversationType={'direct'}
				isDeviceChat={false}
			  />
			)
		})}
	</>
})

export default MessageList

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
		  {page.messageIds.map((_messageId, index) => {
			const messageId: MessageId = _messageId as MessageId 
			const message: Message = page.messages[messageId]
			const key = page.key + '-' + messageId + '-' + index
			return mapFunction(key, messageId, message)

		  })}
		</div>
	)
}
