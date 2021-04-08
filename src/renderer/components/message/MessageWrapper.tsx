import React, { useLayoutEffect } from 'react'
import Message from './Message'
import { MessageType } from '../../../shared/shared-types'
import { C } from 'deltachat-node/dist/constants'
import { getLogger } from '../../../shared/logger'

const log = getLogger('renderer/message/MessageWrapper')

type RenderMessageProps = {
  key2: string
  message: MessageType
  conversationType: 'group' | 'direct'
  isDeviceChat: boolean 
  unreadMessageInViewIntersectionObserver: React.MutableRefObject<any>
}
     
export const MessageWrapper = (props: RenderMessageProps) => {
  const state = props.message.msg.state
  const shouldInViewObserve = state === C.DC_STATE_IN_FRESH || state === C.DC_STATE_IN_NOTICED

  useLayoutEffect(() => {
    if (!shouldInViewObserve) return

    log.debug(`MessageWrapper: key: ${props.key2} We should observe this message if in view`)
    
    const messageBottomElement = document.querySelector('#bottom-' + props.key2)
    if (!messageBottomElement) {
      log.error(`MessageWrapper: key: ${props.key2} couldn't find dom element. Returning`)
      return
    }
    if (!props.unreadMessageInViewIntersectionObserver.current || !props.unreadMessageInViewIntersectionObserver.current.observe) {
      log.error(`MessageWrapper: key: ${props.key2} unreadMessageInViewIntersectionObserver is null. Returning`)
      return
    }
    
    props.unreadMessageInViewIntersectionObserver.current.observe(messageBottomElement)
    log.debug(`MessageWrapper: key: ${props.key2} Successfully observing ;)`)
    
    return () => props.unreadMessageInViewIntersectionObserver.current.unobserve(messageBottomElement)
  }, [])
  
  return (
    <li id={props.key2}>
      <RenderMessage {...props} />
      <div id={'bottom-' + props.key2} />
    </li>
  )
}

export const RenderMessage = React.memo(Message, (prevProps, nextProps) => {
  const areEqual = prevProps.message === nextProps.message
  return areEqual
})
