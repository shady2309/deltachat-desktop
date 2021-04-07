import React, { useEffect } from 'react'
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
  const shouldInViewObserve = props.message.msg.state === C.DC_STATE_IN_FRESH || props.message.msg.state === C.DC_STATE_IN_NOTICED

  useEffect(() => {
    if (!shouldInViewObserve) return

    log.debug(`MessageWrapper: key: ${props.key2} We should observe this message if in view`)
    
    const messageElement = document.querySelector('#' + props.key2)
    if (!messageElement) {
      log.info(`MessageWrapper: key: ${props.key2} couldn't find dom element. Returning`)
      return
    }
    if (!props.unreadMessageInViewIntersectionObserver.current || !props.unreadMessageInViewIntersectionObserver.current.observe) {
      log.info(`MessageWrapper: key: ${props.key2} unreadMessageInViewIntersectionObserver is null. Returning`)
      return
    }
    
    props.unreadMessageInViewIntersectionObserver.current.observe(messageElement)
    log.debug(`MessageWrapper: key: ${props.key2} Successfully observing ;)`)
    
    return () => props.unreadMessageInViewIntersectionObserver.current.unobserve(messageElement)
  }, [])
  
  return (
    <li id={props.key2}>
      <RenderMessage {...props} />
    </li>
  )
}

export const RenderMessage = React.memo(Message, (prevProps, nextProps) => {
  const areEqual = prevProps.message === nextProps.message
  return areEqual
})
