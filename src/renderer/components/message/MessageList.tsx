import React, { useEffect, useRef } from 'react'
import { MessageId, MessageListPage, MessageListStore } from "../../stores/messagelist";
import { Action } from "../../stores/store2";
import { MessageWrapper } from "./MessageWrapper";
import type { Message2, MessageDayMarker, MessageType } from "../../../shared/shared-types";
import { getLogger } from "../../../shared/logger";
import { DayMarkerInfoMessage } from "./Message";
import { MessageType2 } from '../../../shared/shared';
import { ChatStoreState } from '../../stores/chat';
import { C } from 'deltachat-node/dist/constants'

const log = getLogger('renderer/message/MessageList')

const MessageList = React.memo(function MessageList({
	chat,
	refComposer,
  }: {
	chat: ChatStoreState
	refComposer: todo
  }) {

	const messageListRef = useRef(null)
	const messageListWrapperRef = useRef(null)
	const messageListTopRef = useRef(null)
	const messageListBottomRef = useRef(null)
	const onMessageListStoreEffect = () => {

	}
	const onMessageListStoreLayoutEffect = (action: Action) => {
	  if (action.type === 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE') {
		const scrollTop = messageListRef.current.scrollTop
		const scrollHeight = messageListRef.current.scrollHeight
		log.debug(
			`SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE scrollTop: ${scrollTop} scrollHeight ${scrollHeight}`
		)
		
		messageListRef.current.scrollTop = scrollHeight
		console.debug(messageListWrapperRef)
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
		log.debug(`SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE: messageListWrapperHeight: ${messageListWrapperHeight} scrollHeight: ${scrollHeight}`)
		if (scrollHeight <= messageListWrapperHeight) {
			MessageListStore.doneCurrentlyLoadingPage()
			MessageListStore.loadPageBefore([], [{
				isLayoutEffect: true,
				action:{type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {}, id: messageListStore.chatId}
			}])
		} else {
			setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
		}
	  } else if (action.type === 'SCROLL_BEFORE_FIRST_PAGE') {
		log.debug(`SCROLL_BEFORE_FIRST_PAGE`)		  
		const beforeFirstPage = messageListStore.pages[messageListStore.pageOrdering[1]]

		if(!beforeFirstPage) {
			log.debug(`SCROLL_BEFORE_FIRST_PAGE: beforeLastPage is null, returning`)
			setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
			return
		}

		document.querySelector('#' + beforeFirstPage.key).scrollIntoView()
		setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
	  } else if (action.type === 'SCROLL_BEFORE_LAST_PAGE') {
		log.debug(`SCROLL_BEFORE_LAST_PAGE`)		  
		setTimeout(() => {
			const lastPage = messageListStore.pages[messageListStore.pageOrdering[messageListStore.pageOrdering.length - 1]]

			if(!lastPage) {
				log.debug(`SCROLL_BEFORE_LAST_PAGE: lastPage is null, returning`)
				setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
				return
			}
			
			log.debug(`SCROLL_BEFORE_LAST_PAGE lastPage ${lastPage.key}`)		  

			const lastPageElement = document.querySelector('#' + lastPage.key)
			console.debug(lastPageElement)
			const scrollToY = (messageListRef.current.scrollHeight - messageListRef.current.clientHeight - lastPageElement.clientHeight)
			log.debug(`SCROLL_BEFORE_LAST_PAGE scrollToY ${scrollToY}`)		  
			messageListRef.current.scrollTop = scrollToY
			setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
		})
	  }
	}

	const messageListStore = MessageListStore.useStore(onMessageListStoreEffect, onMessageListStoreLayoutEffect)
	
	
	const onMessageListTop: IntersectionObserverCallback = (entries) => {
		const pageOrdering = MessageListStore.state.pageOrdering
		log.debug(`onMessageListTop ${JSON.stringify(pageOrdering)}`)
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true || pageOrdering.length === 0) return
		let withoutPages = []
		let withoutPagesHeight = messageListRef.current.scrollHeight
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
		
		log.debug(`onMessageListTop messageListWrapperHeight: ${messageListWrapperHeight} withoutPagesHeight: ${withoutPagesHeight}`)

		for (let i = pageOrdering.length - 1; i > 0; i--) {
			const pageKey = pageOrdering[i]
			log.debug(`onMessageListTop: pageKey: ${pageKey} i: ${i}`)
			const pageElement = document.querySelector('#' + pageKey)
			if (!pageElement) {
				log.debug(`onMessageListTop: could not find dom element of pageKey: ${pageKey}. Skipping.`)
				continue
			}
			const pageHeight = pageElement.clientHeight
			const updatedWithoutPagesHeight = withoutPagesHeight - pageHeight
			log.debug(`onMessageListTop messageListWrapperHeight: ${messageListWrapperHeight} updatedWithoutPagesHeight: ${updatedWithoutPagesHeight}`)

			if (updatedWithoutPagesHeight > messageListWrapperHeight * 4) {
				withoutPages.push(pageKey)
				withoutPagesHeight = updatedWithoutPagesHeight
			} else {
				log.debug(`onMessageListTop: Found all removable pages. Breaking.`)
				break
			}
		}
		
		log.debug(`onMessageListTop: withoutPages: ${JSON.stringify(withoutPages)}`)

		MessageListStore.loadPageBefore(withoutPages, [
			{
				isLayoutEffect: true,
				action: {type: 'SCROLL_BEFORE_FIRST_PAGE', payload: {}, id: messageListStore.chatId}
			},
		])

	}
	const onMessageListBottom: IntersectionObserverCallback = (entries)  => {
		const pageOrdering = MessageListStore.state.pageOrdering
		log.debug(`onMessageListBottom ${JSON.stringify(pageOrdering)}`)
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true) return
		log.debug('onMessageListBottom')
		let withoutPages = []
		let withoutPagesHeight = messageListRef.current.scrollHeight
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight

		for (let i = 0; i < pageOrdering.length - 1; i++) {
			const pageKey = pageOrdering[i]
			const pageHeight = document.querySelector('#' + pageKey).clientHeight
			const updatedWithoutPagesHeight = withoutPagesHeight - pageHeight

			if (updatedWithoutPagesHeight > messageListWrapperHeight * 4) {
				withoutPages.push(pageKey)
				withoutPagesHeight = updatedWithoutPagesHeight
			} else {
				break
			}
		}
		MessageListStore.loadPageAfter(withoutPages, [
			{
				isLayoutEffect: true,
				action: {type: 'SCROLL_BEFORE_LAST_PAGE', payload: {}, id: messageListStore.chatId}
			},
		])
		
	}
	useEffect(() => {
		console.log('Rerendering MessageList')
		
		let onMessageListTopObserver = new IntersectionObserver(onMessageListTop, {
			root: null,
			rootMargin: '0px',
			threshold: 1.0
		});
		onMessageListTopObserver.observe(messageListTopRef.current)
		let onMessageListBottomObserver = new IntersectionObserver(onMessageListBottom, {
			root: null,
			rootMargin: '0px',
			threshold: 0
		});
		onMessageListBottomObserver.observe(messageListBottomRef.current)
		return () => {
			onMessageListTopObserver.disconnect()
			onMessageListBottomObserver.disconnect()
		}
	}, [])

	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, messageIndex: number, message: Message2) => JSX.Element) => {
		return (
			<div className='message-list-wrapper' style={{height: '100%'}} ref={messageListWrapperRef}>
				<div id='message-list' ref={messageListRef}>   
					<div key='message-list-top' id='message-list-top' ref={messageListTopRef} />
					{messageListStore.pageOrdering.map((pageKey: string) => {
						return <MessagePage key={pageKey} page={messageListStore.pages[pageKey]} mapFunction={mapFunction}/>
					})}
					<div key='message-list-bottom' id='message-list-bottom' ref={messageListBottomRef} />
				</div>
			</div>
		)
	}


	return <>
		{iterateMessages((key, messageId, messageIndex, message) => {
			console.log(key)

            if (message.type === MessageType2.DayMarker) {
				return (
				  <DayMarkerInfoMessage key={key} timestamp={(message.message as MessageDayMarker).timestamp} />
				)
			} else if (message.type === MessageType2.MarkerOne) {
				return (
					<p key={key}>Not implemented yet</p>
				)
			} else if (message.type === MessageType2.Message) {
				console.log('xxx', key)
				return (
				  <ul key={key}>
					  <MessageWrapper
						key={key}
						message={(message.message as MessageType)}
						conversationType={chat.type === C.DC_CHAT_TYPE_GROUP ? 'group' : 'direct'}
						isDeviceChat={chat.isDeviceChat}
					  />
				  </ul>
				)
			} 
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
	mapFunction: (key: string, messageId: MessageId, messageIndex: number, message: Message2) => JSX.Element
}) { 
	const firstMessageIdIndex = page.firstMessageIdIndex
	return (
		<div className={'message-list-page'} id={page.key} key={page.key}>
		  
		  {page.messageIds.map((_messageId, index) => {
			const messageId: MessageId = _messageId as MessageId 
			const messageIndex = firstMessageIdIndex + index
			const message: Message2 = page.messages[index]
			const key = page.key + '-' + messageId + '-' + messageIndex
			return mapFunction(key, messageId, messageIndex, message)

		  })}
		</div>
	)
}
