import React, { useEffect, useRef, useState } from 'react'
import { MessageId, MessageListPage, MessageListStore } from "../../stores/messagelist";
import { Action } from "../../stores/store2";
import { MessageWrapper } from "./MessageWrapper";
import type { Message2, MessageDayMarker, MessageType } from "../../../shared/shared-types";
import { getLogger } from "../../../shared/logger";
import { DayMarkerInfoMessage, UnreadMessagesMarker } from "./Message";
import { MessageType2 } from '../../../shared/shared';
import { ChatStoreState } from '../../stores/chat';
import { C } from 'deltachat-node/dist/constants'
import { jumpToMessage } from '../helpers/ChatMethods';
import { ipcBackend } from '../../ipc';
import { DeltaBackend } from '../../delta-remote';

const log = getLogger('renderer/message/MessageList')



function withoutTopPages(messageListRef: React.MutableRefObject<any>, messageListWrapperRef: React.MutableRefObject<any>) {
	const pageOrdering = MessageListStore.state.pageOrdering

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
	return withoutPages
}
function withoutBottomPages(messageListRef: React.MutableRefObject<any>, messageListWrapperRef: React.MutableRefObject<any>) {
	const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
	let withoutPagesHeight = messageListRef.current.scrollHeight
		
	log.debug(`withoutBottomPages messageListWrapperHeight: ${messageListWrapperHeight} withoutPagesHeight: ${withoutPagesHeight}`)
	
	const pageOrdering = MessageListStore.state.pageOrdering
	let withoutPages = []
	for (let i = pageOrdering.length - 1; i > 0; i--) {
		const pageKey = pageOrdering[i]
		log.debug(`withoutBottomPages: pageKey: ${pageKey} i: ${i}`)
		const pageElement = document.querySelector('#' + pageKey)
		if (!pageElement) {
			log.debug(`withoutBottomPages: could not find dom element of pageKey: ${pageKey}. Skipping.`)
			continue
		}
		const pageHeight = pageElement.clientHeight
		const updatedWithoutPagesHeight = withoutPagesHeight - pageHeight
		log.debug(`withoutBottomPages messageListWrapperHeight: ${messageListWrapperHeight} updatedWithoutPagesHeight: ${updatedWithoutPagesHeight}`)
		if (updatedWithoutPagesHeight > messageListWrapperHeight * 4) {
			withoutPages.push(pageKey)
			withoutPagesHeight = updatedWithoutPagesHeight
		} else {
			log.debug(`withoutBottomPages: Found all removable pages. Breaking.`)
			break
		}
	}
	
	return withoutPages
}

const getPageElement = (pageKey: string) => document.querySelector('#' + pageKey)
const scrollBeforePage = (messageListRef: React.MutableRefObject<any>, pageKey: string, after?: boolean) => {
	const pageElement = getPageElement(pageKey)

	const pageOffsetTop = (pageElement as unknown as any).offsetTop

	if (after === true) {
		const pageHeight = pageElement.clientHeight
		messageListRef.current.scrollTop = pageOffsetTop + pageHeight - messageListRef.current.clientHeight
	} else {
		messageListRef.current.scrollTop = pageOffsetTop - messageListRef.current.clientHeight
	}	 
}

const mathInBetween = (windowLow: number, windowHigh: number, value: number) => {
	return (value >= windowLow && value <= windowHigh)
}

function* messagesInView (messageListRef: React.MutableRefObject<HTMLElement>) {
	const messageElements = document.querySelector('#message-list').querySelectorAll('ul')
	const scrollTop = messageListRef.current.scrollTop
	const messageListClientHeight = messageListRef.current.clientHeight
	const messageListOffsetTop = scrollTop
	const messageListOffsetBottom = messageListOffsetTop + messageListClientHeight
	for (let messageElement of messageElements) {
		const messageOffsetTop = messageElement.offsetTop
		const messageOffsetBottom = messageOffsetTop + messageElement.clientHeight


	
		if (mathInBetween(messageListOffsetTop, messageListOffsetBottom, messageOffsetTop)
			|| mathInBetween(messageListOffsetTop, messageListOffsetBottom, messageOffsetBottom)
			|| (messageOffsetTop < messageListOffsetTop && messageOffsetBottom > messageListOffsetBottom)) {
			yield {
				messageListClientHeight,
				messageListOffsetTop,
				messageListOffsetBottom,
				messageElement,
				messageOffsetTop,
				messageOffsetBottom
			}
		}
	}
}




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
	const onMessageListStoreEffect = (action: Action) => {
	  if (action.type === 'SCROLL_BEFORE_LAST_PAGE') {
		log.debug(`SCROLL_BEFORE_LAST_PAGE`)		  
		setTimeout(() => {
			const lastPage = messageListStore.pages[messageListStore.pageOrdering[messageListStore.pageOrdering.length - 1]]

			if(!lastPage) {
				log.debug(`SCROLL_BEFORE_LAST_PAGE: lastPage is null, returning`)
				return
			}
			
			log.debug(`SCROLL_BEFORE_LAST_PAGE lastPage ${lastPage.key}`)		  

		})
	  }
	}

	const onMessageListStoreLayoutEffect = (action: Action) => {
	  if (action.type === 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE') {
		const scrollTop = messageListRef.current.scrollTop
		const scrollHeight = messageListRef.current.scrollHeight
		log.debug(
			`SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE scrollTop: ${scrollTop} scrollHeight ${scrollHeight}`
		)
		
		messageListRef.current.scrollTop = scrollHeight
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
		log.debug(`SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE: messageListWrapperHeight: ${messageListWrapperHeight} scrollHeight: ${scrollHeight}`)
		if (scrollHeight <= messageListWrapperHeight) {
			MessageListStore.loadPageBefore(messageListStore.chatId, [], [{
				isLayoutEffect: true,
				action:{type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: {}, id: messageListStore.chatId}
			}])
		}
	  } else if (action.type === 'SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE') {
		const { pageKey } = action.payload
		const scrollTop = messageListRef.current.scrollTop
		const scrollHeight = messageListRef.current.scrollHeight
		log.debug(
			`SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE scrollTop: ${scrollTop} scrollHeight ${scrollHeight}`
		)

		const pageElement = document.querySelector('#' + pageKey)
		if(!pageElement) {
			log.warn(
				`SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE pageElement is null, returning`
			)
			return
		}
		pageElement.scrollIntoView(true)
		const firstChild = pageElement.firstElementChild
		if(!firstChild) {
			log.warn(
				`SCROLL_TO_TOP_OF_PAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE firstChild is null, returning`
			)
			return
		}
		// TODO: Implement check to load more
		firstChild.setAttribute('style', 'background-color: yellow')
	  } else if (action.type === 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE') {
		const { pageKey, messageIdIndex } = action.payload
		const pageElement = document.querySelector('#' + pageKey)
		if(!pageElement) {
			log.warn(
				`SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE pageElement is null, returning`
			)
			return
		}

		const messageKey = calculateMessageKey(pageKey, messageListStore.messageIds[messageIdIndex], messageIdIndex)

		const messageElement = pageElement.querySelector('#' + messageKey)
		if(!messageElement) {
			log.warn(
				`SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE messageElement is null, returning`
			)
			return
		}
		//messageElement.setAttribute('style', 'background-color: yellow')

		let scrollTop = messageListRef.current.scrollTop
		const scrollHeight = messageListRef.current.scrollHeight
		const clientHeight = messageListRef.current.clientHeight
		scrollTop = messageListRef.current.scrollTop = (messageElement as unknown as any).offsetTop
		if (scrollTop === 0 && MessageListStore.canLoadPageBefore(pageKey)) {	
			log.debug(`SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE: scrollTop === 0, load page before`)


			MessageListStore.loadPageBefore(action.id, [], [{
				isLayoutEffect: true,
				action:{type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: action.payload, id: messageListStore.chatId}
			}])
		} else if ((scrollHeight - scrollTop) <= clientHeight && MessageListStore.canLoadPageAfter(pageKey)) {
			log.debug(`SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE: ((scrollHeight - scrollTop) <= clientHeight) === true, load page after`)
			MessageListStore.loadPageAfter(action.id, [], [{
				isLayoutEffect: true,
				action:{type: 'SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: action.payload, id: messageListStore.chatId}
			}])
		} else {
			log.debug(`SCROLL_TO_MESSAGE_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE no need to load anything`)
		}

	  } else if (action.type === 'SCROLL_BEFORE_FIRST_PAGE') {
		log.debug(`SCROLL_BEFORE_FIRST_PAGE`)		  
		const beforeFirstPage = messageListStore.pages[messageListStore.pageOrdering[1]]

		if(!beforeFirstPage) {
			log.debug(`SCROLL_BEFORE_FIRST_PAGE: beforeLastPage is null, returning`)
			return
		}

		document.querySelector('#' + beforeFirstPage.key).scrollIntoView()
	  } else if (action.type === 'INCOMING_MESSAGES') {
		  if (action.id !== MessageListStore.state.chatId) {
			  log.debug(`INCOMING_MESSAGES: action id mismatches state.chatId. Returning.`)
			  return
		  }

		  const countIncomingMessages = action.payload

		  const scrollTop = messageListRef.current.scrollTop
		  const scrollHeight = messageListRef.current.scrollHeight
		  const wrapperHeight = messageListWrapperRef.current.clientHeight
		  
		  const lastPageKey = MessageListStore.state.pageOrdering[MessageListStore.state.pageOrdering.length - 1]
		  const lastPage = MessageListStore.state.pages[lastPageKey]
		  
		  const isPreviousMessageLoaded = lastPage.messageIds[lastPage.messageIds.length - 1] === MessageListStore.state.messageIds[MessageListStore.state.messageIds.length - 2]
		  
		  log.debug(`INCOMING_MESSAGES: scrollHeight: ${scrollHeight} scrollTop: ${scrollTop} wrapperHeight: ${wrapperHeight}`)

		  const isScrolledToBottom = scrollTop >= scrollHeight - wrapperHeight 

		  const scrollToTopOfMessage = isScrolledToBottom && isPreviousMessageLoaded
		  log.debug(`INCOMING_MESSAGES: scrollToTopOfMessage ${scrollToTopOfMessage} isScrolledToBottom: ${isScrolledToBottom} isPreviousMessageLoaded: ${isPreviousMessageLoaded}`)

		  if (scrollToTopOfMessage) {
			const withoutPages = withoutTopPages(messageListRef, messageListWrapperRef)
			const messageId = MessageListStore.state.messageIds[MessageListStore.state.messageIds.length - 1] 

			MessageListStore.loadPageAfter(action.id, withoutPages, [
				{
					isLayoutEffect: true,
					action: {type: 'SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE', payload: messageId, id: messageListStore.chatId}
				},
			])
		  }
		} else if (action.type === 'RESTORE_SCROLL_POSITION') {
		  	if (action.id !== MessageListStore.state.chatId) {
			  log.debug(`RESTORE_SCROLL_POSITION: action id mismatches state.chatId. Returning.`)
			  return
			}
			messageListRef.current.scrollTop = scrollPositionBeforeSetState.current
			log.debug(`RESTORE_SCROLL_POSITION: restored scrollPosition to ${action.payload}`)
		} else if (action.type === 'SCROLL_TO_POSITION') {
			if (action.id !== MessageListStore.state.chatId) {
			log.debug(`SCROLL_TO_POSITION: action id mismatches state.chatId. Returning.`)
			return
		  }
		  messageListRef.current.scrollTop = action.payload
		  log.debug(`SCROLL_TO_POSITION: restored scrollPosition to ${action.payload}`)
	  }
	}

	const scrollPositionBeforeSetState = useRef(-1)
	const beforeSetState = () => {
		scrollPositionBeforeSetState.current = messageListRef.current.scrollTop
	}

	const messageListStore = MessageListStore.useStore(onMessageListStoreEffect, onMessageListStoreLayoutEffect)
	
	
	const onMessageListTop: IntersectionObserverCallback = (entries) => {
		const chatId = MessageListStore.state.chatId
		const pageOrdering = MessageListStore.state.pageOrdering
		log.debug(`onMessageListTop`)
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true || pageOrdering.length === 0) return
		let withoutPages = withoutBottomPages(messageListRef, messageListWrapperRef)

		MessageListStore.loadPageBefore(chatId, withoutPages, [
			{
				isLayoutEffect: true,
				action: {type: 'SCROLL_BEFORE_FIRST_PAGE', payload: {}, id: chatId}
			},
		])

	}
	const onMessageListBottom: IntersectionObserverCallback = (entries)  => {
		const chatId = MessageListStore.state.chatId
		const pageOrdering = MessageListStore.state.pageOrdering
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true || pageOrdering.length === 0) return
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
		MessageListStore.loadPageAfter(chatId, withoutPages, [
			{
				isLayoutEffect: false,
				action: {type: 'SCROLL_BEFORE_LAST_PAGE', payload: {}, id: chatId}
			},
		])
		
	}
	

	let unreadMessageInViewIntersectionObserver = useRef(null)
	const onUnreadMessageInView: IntersectionObserverCallback = (entries)  => {
		const chatId = MessageListStore.state.chatId
		setTimeout(() => {
			log.debug(`onUnreadMessageInView: entries.length: ${entries.length}`)
			
			const messageListWrapperHeight = messageListWrapperRef.current.clientHeight

			let messageIdsToMarkAsRead = []
			for (let entry of entries) {
				if (!entry.isIntersecting) continue
				const messageKey = entry.target.getAttribute('id')
				const messageId = messageKey.split('-')[4]
				const messageHeight = entry.target.clientHeight

				log.debug(`onUnreadMessageInView: messageId ${messageId} height: ${messageHeight} intersectionRate: ${entry.intersectionRatio}`)
				log.debug(`onUnreadMessageInView: messageId ${messageId} marking as read`)
				
				messageIdsToMarkAsRead.push(Number.parseInt(messageId))
				unreadMessageInViewIntersectionObserver.current.unobserve(entry.target)
			}

			if (messageIdsToMarkAsRead.length > 0) {
				MessageListStore.markMessagesSeen(chatId, messageIdsToMarkAsRead)
			}
		})
	}

	const onMsgsChanged = async () => {
		const chatId = MessageListStore.state.chatId

		const scrollTop = messageListRef.current.scrollTop
		const scrollHeight = messageListRef.current.scrollHeight
		const wrapperHeight = messageListWrapperRef.current.clientHeight
		const isScrolledToBottom = scrollTop >= scrollHeight - wrapperHeight 
		
		if (isScrolledToBottom) {
			MessageListStore.selectChat(chatId)
			return
		}

		const unreadMessageIds = await DeltaBackend.call('messageList.getUnreadMessageIds', chatId)
		const firstUnreadMessageId = unreadMessageIds.length > 0 ? unreadMessageIds[0] : -1
		const marker1MessageId = firstUnreadMessageId || 0

      	const messageIds = await DeltaBackend.call('messageList.getMessageIds', chatId, marker1MessageId)
		
		let firstMessageIndex = -1
		let restoreScrollPosition = -1
		const _messagesInView = Array.from(messagesInView(messageListRef))

		if (_messagesInView.length === 0) {
			log.debug('onMsgsChanged: No message in view. Returning.')
			return
		}

		for (let {messageElement, messageListOffsetTop, messageOffsetTop} of _messagesInView) {
			const { messageId, messageIndex: oldMessageIndex } = parseMessageKey(messageElement.getAttribute('id'))
			console.log(messageId)
			
			const messageIndex = messageIds.indexOf(messageId)
			if (messageId <= 9 && oldMessageIndex !== messageIndex) {
				continue
			}
			
			if (messageIndex === -1) continue

			firstMessageIndex = messageIndex
			restoreScrollPosition = Math.abs(messageOffsetTop - messageListOffsetTop)
			break
		}

		if (firstMessageIndex === -1) {
			const {messageIndex: indexOfFirstMessageInView} = parseMessageKey(_messagesInView[0].messageElement.getAttribute('id'))
			log.debug(`onMsgsChanged: No message in view is in changed messageIds. Trying to find closest still existing message. indexOfFirstMessageInView: ${indexOfFirstMessageInView}`)
			const oldMessageIds = MessageListStore.state.messageIds

			for (let oldMessageIndex of rotateAwayFromIndex(indexOfFirstMessageInView, messageIds.length)) {
				const messageId = oldMessageIds[oldMessageIndex]
				const realMessageIndex = messageIds.indexOf(messageId)
				console.log(oldMessageIndex, messageId, realMessageIndex)
				if (messageId <= 9 && oldMessageIndex !== realMessageIndex) {
					continue
				}
				
				if (realMessageIndex === -1) continue
				firstMessageIndex = realMessageIndex
				break
			}
			// In theory it would be better/more accurate to jump to the bottom if firstMessageIndex < indexOfFirstMessageInView  
			// and to the top of the message if firstMessageIndex > indexOfFirstMessageInView
			// But this should be good enough for now
			MessageListStore.jumpToMessage(chatId, messageIds[firstMessageIndex])
			return
			
		}

		if (firstMessageIndex === -1) {
			log.debug('onMsgsChanged: Could not find a message to restore from. Reloading chat.')
			MessageListStore.selectChat(chatId)
			return
		}

		if (MessageListStore.currentlyDispatchedCounter > 0) return
		MessageListStore.refresh(chatId, messageIds, firstMessageIndex, restoreScrollPosition === -1 ? null : [
			{action: {type: 'SCROLL_TO_POSITION', payload: restoreScrollPosition, id: chatId}, isLayoutEffect: true}
		])
	}

	const onIncomingMessage = async (_event: any, [chatId, messageId]: [number, number]) => {
		if (chatId !== MessageListStore.state.chatId) {
			log.debug('onMsgsChanged: Currently loading page, returning')
			return
		}
		onMsgsChanged()			
	}

	useEffect(() => {
		let onMessageListTopObserver = new IntersectionObserver(onMessageListTop, {
			root: null,
			rootMargin: '80px',
			threshold: 0
		});
		onMessageListTopObserver.observe(messageListTopRef.current)
		let onMessageListBottomObserver = new IntersectionObserver(onMessageListBottom, {
			root: null,
			rootMargin: '80px',
			threshold: 0
		});
		onMessageListBottomObserver.observe(messageListBottomRef.current)
		unreadMessageInViewIntersectionObserver.current = new IntersectionObserver(onUnreadMessageInView, {
			root: null,
			rootMargin: '0px',
			threshold: [0, 1]
		});
		
		ipcBackend.on('DC_EVENT_MSGS_CHANGED', onMsgsChanged)
		ipcBackend.on('DC_EVENT_INCOMING_MSG', onIncomingMessage)


		// ONLY FOR DEBUGGING, REMOVE BEFORE MERGE
		;(window as unknown as any).messagesInView = () => {
			for (let m of messagesInView(messageListRef)) {
				console.debug(m.messageElement)
			}
		}
		;(window as unknown as any).refreshMessages = onMsgsChanged

		return () => {
			onMessageListTopObserver.disconnect()
			onMessageListBottomObserver.disconnect()
			unreadMessageInViewIntersectionObserver.current?.disconnect()
			ipcBackend.removeListener('DC_EVENT_MSGS_CHANGED', onMsgsChanged)
			ipcBackend.removeListener('DC_EVENT_INCOMING_MSG', onIncomingMessage)
		}
	}, [])
	
	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, messageIndex: number, message: Message2) => JSX.Element) => {
		return messageListStore.pageOrdering.map((pageKey: string) => {
			return <MessagePage key={pageKey} page={messageListStore.pages[pageKey]} mapFunction={mapFunction}/>
		})
	}


	return <>
		<div className='message-list-wrapper' style={{height: '100%'}} ref={messageListWrapperRef}>
			<div id='message-list' ref={messageListRef}>   
				<div key='message-list-top' id='message-list-top' ref={messageListTopRef} />
				{iterateMessages((key, messageId, messageIndex, message) => {
					if (message.type === MessageType2.DayMarker) {
						return (
						  <ul key={key} id={key}>
							<DayMarkerInfoMessage key={key} timestamp={(message.message as MessageDayMarker).timestamp} />
						  </ul>
						)
					} else if (message.type === MessageType2.MarkerOne) {
						return (
						  <ul key={key} id={key}>
							<UnreadMessagesMarker key={key} count={messageListStore.marker1MessageCount} />
						  </ul>
						)
					} else if (message.type === MessageType2.Message) {
						  
		  
						return (
						  <ul key={key} id={key}>
							  <MessageWrapper
								key={key}
								key2={key}
								message={(message.message as MessageType)}
								conversationType={chat.type === C.DC_CHAT_TYPE_GROUP ? 'group' : 'direct'}
								isDeviceChat={chat.isDeviceChat}
								unreadMessageInViewIntersectionObserver={unreadMessageInViewIntersectionObserver}
							  />
						  </ul>
						)
					} 
				})}
				<div key='message-list-bottom' id='message-list-bottom' ref={messageListBottomRef} />
			</div>
		</div>
		{messageListStore.unreadMessageIds.length > 0 && <div className='unread-message-counter'>
			<div className='counter'>{messageListStore.unreadMessageIds.length}</div>
			<div className='jump-to-bottom-button' onClick={() => {jumpToMessage(messageListStore.messageIds[messageListStore.messageIds.length - 1])}} />
		</div>}
	</>
})

export default MessageList


export function calculateMessageKey(pageKey: string, messageId: number, messageIndex: number) {
	return pageKey + '-' + messageId + '-' + messageIndex
}

export function parseMessageKey(messageKey: string) {
	const splittedMessageKey = messageKey.split('-')
	if (splittedMessageKey[0] !== 'page' && splittedMessageKey.length === 5	) {
		throw new Error('Expected a proper messageKey')
	}
	return {
		pageKey: `page-${splittedMessageKey[1]}-${splittedMessageKey[2]}`,
		messageId: Number.parseInt(splittedMessageKey[3]),
		messageIndex: Number.parseInt(splittedMessageKey[4])
	}
}

export function* rotateAwayFromIndex(index: number, length: number) {
	let count = 0

	let distance = 1
	while (count < length - 1) {
		const positive_rotate_index = index + distance
		if (positive_rotate_index < length) {
			yield positive_rotate_index
			count++
		}
		const negative_rotate_index = index - distance
		if (negative_rotate_index >= 0) {
			yield negative_rotate_index
			count++
		}
		distance++
	}
}

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
		  
		  {page.messageIds.map((messageId: MessageId, index) => {
			const messageIndex = firstMessageIdIndex + index
			const message: Message2 = page.messages[index]
			if (message === null) return null
			const messageKey = calculateMessageKey(page.key, messageId, messageIndex)
			return mapFunction(messageKey, messageId, messageIndex, message)

		  })}
		</div>
	)
}
