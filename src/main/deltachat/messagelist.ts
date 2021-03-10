import { C, MessageState } from 'deltachat-node'
import { getLogger } from '../../shared/logger'

const log = getLogger('main/deltachat/messagelist')

import filesizeConverter from 'filesize'
import mime from 'mime-types'

import SplitOut from './splitout'
import { Message } from 'deltachat-node'
import {
  MessageType,
  MessageSearchResult,
  MessageTypeAttachment,
  msgStatus,
  Message2,
} from '../../shared/shared-types'

import { writeFile } from 'fs-extra'
import tempy from 'tempy'
import { getAccountsPath } from '../application-constants'
import { join } from 'path'
import { MessageType2 } from '../../shared/shared'
export default class DCMessageList extends SplitOut {
  sendMessage(
    chatId: number,
    {
      text,
      filename,
      location,
      quoteMessageId,
    }: {
      text?: string
      filename?: string
      location?: { lat: number; lng: number }
      quoteMessageId?: number
    }
  ): [number, Message2] {
    const viewType = filename ? C.DC_MSG_FILE : C.DC_MSG_TEXT
    const msg = this._dc.messageNew(viewType)
    if (filename) msg.setFile(filename, undefined)
    if (text) msg.setText(text)
    if (location) msg.setLocation(location.lat, location.lng)

    if (quoteMessageId) {
      const quotedMessage = this._dc.getMessage(quoteMessageId)
      if (!quotedMessage) {
        log.error('sendMessage: Message to quote not found')
      } else {
        msg.setQuote(quotedMessage)
      }
    }

    const messageId = this._dc.sendMessage(chatId, msg)
    const _msg = this._dc.getMessage(messageId)
    const message = _msg ? { type: MessageType2.Message, message: this._messageToJson(_msg) } : null
    return [messageId, message]
  }

  sendSticker(chatId: number, fileStickerPath: string) {
    const viewType = C.DC_MSG_STICKER
    const msg = this._dc.messageNew(viewType)
    const stickerPath = fileStickerPath.replace('file://', '')
    msg.setFile(stickerPath, undefined)
    this._dc.sendMessage(chatId, msg)
  }

  deleteMessage(id: number) {
    log.info(`deleting messages ${id}`)
    this._dc.deleteMessages([id])
  }

  getMessage(msgId: number) {
    return this.messageIdToJson(msgId)
  }

  getMessageInfo(msgId: number) {
    return this._dc.getMessageInfo(msgId)
  }

  getFirstUnreadMessageId(chatId: number) {
    const countFreshMessages = this._dc.getFreshMessageCount(chatId)
    const messageIds = this._dc.getChatMessages(chatId, 0, 0)

    let foundFreshMessages = 0
    let firstUnreadMessageId = -1
    for(let i = messageIds.length -1; i >= 0; i--) {
      const messageId = messageIds[i]

      if (!this._dc.getMessage(messageId).getState().isFresh()) continue
        
      foundFreshMessages++
      firstUnreadMessageId = messageId

      if (foundFreshMessages >= countFreshMessages) {
        break
      }
    } 

    return firstUnreadMessageId
  }

  async getDraft(chatId: number): Promise<MessageType | null> {
    const draft = this._dc.getDraft(chatId)
    return draft ? this._messageToJson(draft) : null
  }

  setDraft(
    chatId: number,
    {
      text,
      file,
      quotedMessageId,
    }: { text?: string; file?: string; quotedMessageId?: number }
  ) {
    const viewType = file ? C.DC_MSG_FILE : C.DC_MSG_TEXT
    const draft = this._dc.messageNew(viewType)
    if (file) draft.setFile(file, undefined)
    if (text) draft.setText(text)
    if (quotedMessageId) {
      const quotedMessage = this._dc.getMessage(quotedMessageId)
      if (!quotedMessage) {
        log.error('setDraftquote: Message to quote not found')
      } else {
        draft.setQuote(quotedMessage)
      }
    }

    this._dc.setDraft(chatId, draft)
  }

  messageIdToJson(id: number) {
    const msg = this._dc.getMessage(id)
    if (!msg) {
      log.warn('No message found for ID ' + id)
      const empty: { msg: null } = { msg: null }
      return empty
    }
    return this._messageToJson(msg)
  }

  _messageToJson(msg: Message): MessageType {
    const filemime = msg.getFilemime()
    const filename = msg.getFilename()
    const filesize = msg.getFilebytes()
    const viewType = msg.getViewType()
    const fromId = msg.getFromId()
    const isMe = fromId === C.DC_CONTACT_ID_SELF
    const setupCodeBegin = msg.getSetupcodebegin()
    const contact = fromId && this._controller.contacts.getContact(fromId)
    const direction = (isMe ? 'outgoing' : 'incoming') as
      | 'outgoing'
      | 'incoming'

    const jsonMSG = msg.toJson()

    const attachment: MessageTypeAttachment = jsonMSG.file && {
      url: jsonMSG.file,
      contentType: convertContentType({
        filemime,
        viewType: jsonMSG.viewType,
        file: jsonMSG.file,
      }),
      fileName: filename || jsonMSG.text,
      fileSize: filesizeConverter(filesize),
    }

    return {
      id: msg.getId(),
      msg: Object.assign(jsonMSG, {
        sentAt: jsonMSG.timestamp * 1000,
        receivedAt: jsonMSG.receivedTimestamp * 1000,
        direction,
        status: convertMessageStatus(jsonMSG.state),
        attachment,
      }),
      filemime,
      filename,
      filesize,
      viewType,
      fromId,
      isMe,
      contact: (contact ? { ...contact } : {}) as any,
      isInfo: msg.isInfo(),
      setupCodeBegin,
    }
  }

  forwardMessage(msgId: number, chatId: number) {
    this._dc.forwardMessages([msgId], chatId)
    this._controller.chatList.selectChat(chatId)
  }

  getMessageIds(chatId: number) {
    const messageIds = this._dc.getChatMessages(
      chatId,
      C.DC_GCM_ADDDAYMARKER,
      0
    )
    return messageIds
  }
  async getMessages2(chatId: number, indexStart: number, indexEnd: number): Promise<Message2[]> {
    const messageIds = this.getMessageIds(chatId)

    let length = indexEnd - indexStart
    let messages: Message2[] = new Array(length + 1)
    for (let i = 0; i <= length; i++) {
      const messageIndex = indexStart + i
      const messageId = messageIds[messageIndex]
      
      let messageObject: Message2 = null;
      if (messageId == C.DC_MSG_ID_DAYMARKER) {
        const nextMessageIndex = messageIndex + 1
        const nextMessageId = messageIds[nextMessageIndex]
        const nextMessageTimestamp = this._dc.getMessage(nextMessageId).getTimestamp()
        messageObject = {
          type: MessageType2.DayMarker,
          message: {
            timestamp: nextMessageTimestamp
          }
        }
      } else if (messageId === C.DC_MSG_ID_MARKER1) {
        messageObject = {
          type: MessageType2.MarkerOne,
          message: null
        }

      } else if (messageId <= C.DC_MSG_ID_LAST_SPECIAL) {
        log.debug(`getMessages2: not sure what do with this messageId: ${messageId}, skipping`)
        
      } else {
        const msg = this._dc.getMessage(messageId)
        if(msg) {
          const message = this._messageToJson(msg)
          messageObject = {
            type: MessageType2.Message,
            message
          }

        }
      }
      
      messages[i] = messageObject
    }
    return messages

  }
  
  getMessages(messageIds: number[]) {
    const messages: {
      [key: number]: ReturnType<typeof DCMessageList.prototype.messageIdToJson>
    } = {}
    const markMessagesRead: number[] = []
    messageIds.forEach(messageId => {
      if (messageId <= C.DC_MSG_ID_LAST_SPECIAL) return
      const message = this.messageIdToJson(messageId)
      if (
        message.msg.direction === 'incoming' &&
        message.msg.state !== C.DC_STATE_IN_SEEN
      ) {
        markMessagesRead.push(messageId)
      }
      messages[messageId] = message
    })

    if (markMessagesRead.length > 0) {
      const chatId = messages[markMessagesRead[0]].msg.chatId

      log.debug(
        `markMessagesRead ${markMessagesRead.length} messages for chat ${chatId}`
      )
      // TODO: move mark seen logic to frontend
      setTimeout(() => this._dc.markSeenMessages(markMessagesRead))
    }
    return messages
  }

  markSeenMessages(messageIds: number[]) {
    this._dc.markSeenMessages(messageIds)
  }

  searchMessages(query: string, chatId = 0): number[] {
    return this._dc.searchMessages(chatId, query)
  }

  private _msgId2SearchResultItem(msgId: number): MessageSearchResult {
    const message = this._dc.getMessage(msgId)
    const chat = this._dc.getChat(message.getChatId())
    const author = this._dc.getContact(message.getFromId())

    return {
      id: msgId,
      authorProfileImage: author.getProfileImage(),
      author_name: author.getDisplayName(),
      author_color: author.color,
      chat_name: chat.isSingle() ? null : chat.getName(),
      message: message.getText(),
      timestamp: message.getTimestamp(),
    }
  }

  msgIds2SearchResultItems(ids: number[]) {
    const result: { [id: number]: MessageSearchResult } = {}
    for (const id of ids) {
      result[id] = this._msgId2SearchResultItem(id)
    }
    return result
  }

  /** @returns file path to html file */
  async saveMessageHTML2Disk(messageId: number): Promise<string> {
    const message_html_content = this._dc.getMessageHTML(messageId)
    const pathToFile = tempy.file({ extension: 'html' })
    await writeFile(pathToFile, message_html_content, { encoding: 'utf-8' })
    return pathToFile
  }
}

function convertMessageStatus(s: number): msgStatus {
  switch (s) {
    case C.DC_STATE_IN_FRESH:
      return 'sent'
    case C.DC_STATE_OUT_FAILED:
      return 'error'
    case C.DC_STATE_IN_SEEN:
      return 'read'
    case C.DC_STATE_IN_NOTICED:
      return 'read'
    case C.DC_STATE_OUT_DELIVERED:
      return 'delivered'
    case C.DC_STATE_OUT_MDN_RCVD:
      return 'read'
    case C.DC_STATE_OUT_PENDING:
      return 'sending'
    case C.DC_STATE_UNDEFINED:
      return 'error'
  }
}

function convertContentType({
  filemime,
  viewType,
  file,
}: {
  filemime: string
  viewType: number
  file: string
}) {
  if (!filemime) return 'application/octet-stream'
  if (filemime !== 'application/octet-stream') return filemime

  switch (viewType) {
    case C.DC_MSG_IMAGE:
      return 'image/jpg'
    case C.DC_MSG_VOICE:
      return 'audio/ogg'
    case C.DC_MSG_FILE:
      return mime.lookup(file) || 'application/octet-stream'
    default:
      return 'application/octet-stream'
  }
}
