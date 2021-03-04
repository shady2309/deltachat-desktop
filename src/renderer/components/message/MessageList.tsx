import { ChatStoreState } from "../../stores/chat";
import React, { useEffect } from 'react'
import { Message } from "deltachat-node";
import { MessageId, MessageListPage, MessageListStore } from "../../stores/messagelist";
import { Action } from "../../stores/store2";



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
			return <div className='message' key={key}>
			  key: {key}
			  messageId: {messageId}
			  message: {JSON.stringify(message)}
			</div>
		})}
		{JSON.stringify(messageListStore)}

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
		  {page.messageIds.map((_messageId) => {
			const messageId: MessageId = _messageId as MessageId 
			const message: Message = page.messages[messageId]
			const key = page.key + '-' + messageId
			return mapFunction(key, messageId, message)

		  })}
		</div>
	)
}
