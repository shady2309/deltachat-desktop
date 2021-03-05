import { ChatStoreState } from "../../stores/chat";
import React, { useEffect, useRef, useState } from 'react'
import { MessageId, Message, MessageListPage, MessageListStore } from "../../stores/messagelist";
import { Action } from "../../stores/store2";
import { MessageWrapper } from "./MessageWrapper";
import { MessageType } from "../../../shared/shared-types";
import { getLogger } from "../../../shared/logger";

const log = getLogger('renderer/message/MessageList')


const useIntersectionObserver = ({ root = null, rootMargin, threshold = 0 }: {root: any, rootMargin: any, threshold: any}) => {
	const [entry, updateEntry] = useState({});
	const [node, setNode] = useState(null);
  
	const observer = useRef(
	  new window.IntersectionObserver(([entry]) => updateEntry(entry), {
		root,
		rootMargin,
		threshold
	  })
	);
  
	useEffect(
	  () => {
		const { current: currentObserver } = observer;
		currentObserver.disconnect();
  
		if (node) currentObserver.observe(node);
  
		return () => currentObserver.disconnect();
	  },
	  [node]
	);
  
	return [setNode, entry];
  }
  
const MessageList = React.memo(function MessageList({
}) {

	const messageListRef = useRef(null)
	const messageListWrapperRef = useRef(null)
	const messageListTopRef = useRef(null)
	const messageListBottomRef = useRef(null)
	const onMessageListStoreEffect = (action: Action) => {

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
		const messageListHeight = messageListRef.current.clientHeight
		log.debug(`SCROLL_TO_BOTTOM_AND_CHECK_IF_WE_NEED_TO_LOAD_MORE: messageListWrapperHeight: ${messageListWrapperHeight} scrollHeight: ${scrollHeight}`)
		if (scrollHeight <= messageListWrapperHeight) {
			MessageListStore.doneCurrentlyLoadingPage()
			MessageListStore.loadPageBefore([{
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
			messageListRef.current.scrollTo(0, scrollToY)
			setTimeout(() => MessageListStore.doneCurrentlyLoadingPage())
		})
	  } else if (action.type === 'DELETE_LAST_PAGE_IF_POSSIBLE') {
		log.debug(`DELETE_LAST_PAGE_IF_POSSIBLE`)		  
		const scrollHeight = messageListRef.current.scrollHeight
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
		const lastPageKey = messageListStore.pageOrdering[messageListStore.pageOrdering.length - 1]
		const lastPageHeight = document.querySelector('#' + lastPageKey).clientHeight
		
		if (scrollHeight - lastPageHeight > 4 * messageListWrapperHeight) {
			MessageListStore.removePage(lastPageKey)
		}
	  } else if (action.type === 'DELETE_FIRST_PAGE_IF_POSSIBLE') {
		log.debug(`DELETE_FIRST_PAGE_IF_POSSIBLE`)		  
		const scrollHeight = messageListRef.current.scrollHeight
		const messageListWrapperHeight = messageListWrapperRef.current.clientHeight
		const firstPageKey = messageListStore.pageOrdering[0]
		const firstPageHeight = document.querySelector('#' + firstPageKey).clientHeight
		
		if (scrollHeight - firstPageHeight > 4 * messageListWrapperHeight) {
			MessageListStore.removePage(firstPageKey)
		}
	  }
	}

	const messageListStore = MessageListStore.useStore(onMessageListStoreEffect, onMessageListStoreLayoutEffect)
	
	const onMessageListTop: IntersectionObserverCallback = (entries) => {
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true) return
		log.debug('onMessageListTop')
		MessageListStore.loadPageBefore([
			{
				isLayoutEffect: true,
				action: {type: 'SCROLL_BEFORE_FIRST_PAGE', payload: {}, id: messageListStore.chatId}
			},
			{
				isLayoutEffect: true,
				action: {type: 'DELETE_LAST_PAGE_IF_POSSIBLE', payload: {}, id: messageListStore.chatId}
				
			}
		])

	}
	const onMessageListBottom: IntersectionObserverCallback = (entries)  => {
		if(!entries[0].isIntersecting || MessageListStore.currentlyLoadingPage === true) return
		log.debug('onMessageListBottom')
		MessageListStore.loadPageAfter([
			{
				isLayoutEffect: true,
				action: {type: 'DELETE_FIRST_PAGE_IF_POSSIBLE', payload: {}, id: messageListStore.chatId}
			},
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

	const iterateMessages = (mapFunction: (key: string, messageId: MessageId, message: Message) => JSX.Element) => {
		return (
			<div className='message-list-wrapper' style={{height: '100%'}} ref={messageListWrapperRef}>
				<div id='message-list' ref={messageListRef}>   
					<div id='message-list-top' ref={messageListTopRef} />
					{messageListStore.pageOrdering.map((pageKey: string) => {
						return <MessagePage page={messageListStore.pages[pageKey]} mapFunction={mapFunction}/>
					})}
					<div id='message-list-bottom' ref={messageListBottomRef} />
				</div>
			</div>
		)
	}


	return <>
		{iterateMessages((key, messageId, message) => {
			console.log(key)
			if (messageId === 9) return null
			return (
			  <ul>
				  <MessageWrapper
					key={key}
					message={message as MessageType}
					conversationType={'direct'}
					isDeviceChat={false}
				  />
			  </ul>
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
		<div className={'message-list-page'} id={page.key} key={page.key}>
		  {page.messageIds.map((_messageId, index) => {
			const messageId: MessageId = _messageId as MessageId 
			const message: Message = page.messages[messageId]
			const key = page.key + '-' + messageId + '-' + index
			return mapFunction(key, messageId, message)

		  })}
		</div>
	)
}
