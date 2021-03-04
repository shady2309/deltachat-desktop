import { useState, useEffect } from 'react'
import { getLogger, Logger } from '../../shared/logger'

export function useStore<T extends Store<any>>(
  StoreInstance: T
): [T extends Store<infer S> ? S : any, T['dispatch']] {
  const [state, setState] = useState(StoreInstance.getState())

  useEffect(() => {
    StoreInstance.subscribe(setState)
    return () => StoreInstance.unsubscribe(setState)
  }, [])
  // TODO: better return an object to allow destructuring
  return [state, StoreInstance.dispatch.bind(StoreInstance)]
}

export type ActionType = string
export type ActionPayload = any | undefined
export type ActionId = number | undefined
export interface Action {
  type: ActionType
  payload: ActionPayload
  id: ActionId
}

export interface EffectInterface<S>{
  (action: Action, state: S, log: ReturnType<typeof getLogger>) : Promise<S>
}

export class Store<S> {
  private listeners: ((state: S) => void)[] = []
  private effects: {[key: string]: EffectInterface<S>} = {}
  private _log: ReturnType<typeof getLogger>
  
  constructor(public state: S, name?: string) {
    if (!name) name = 'Store2'
    this._log = getLogger('renderer/stores/' + name)
  }

  get log() {
    return this._log
  }

  actionLogger(type: ActionType): ReturnType<typeof getLogger> {
    const {      
      getStackTrace,
      debug,
      info,
      warn,
      isMainProcess,
      channel,
      error,
       critical
    } = this.log
    return {
      getStackTrace,
      isMainProcess,
      channel,
      debug: (...args) => debug(type, ...args),
      info: (...args) => info(type, ...args),
      warn: (...args) => warn(type, ...args),
      error: (...args) => error(type, ...args),
      critical: (...args) => critical(type, ...args)
    }
  }

  getState() {
    return this.state
  }

  async dispatch(type: ActionType, payload: ActionPayload, id: ActionId) {
    this.log.debug('DISPATCH of type', type)
    let state = this.state
    
    const effect = this.effects[type]

    const action: Action = { type, payload, id}
    const updatedState = await effect(action, state, this.actionLogger(type))
    
    if (updatedState !== this.state) {
      this.log.debug(
        `DISPATCHING of "${type}" changed the state. Before:`,
        this.state,
        'After:',
        state
      )
      this.log.debug(`DISPATCHING of "${type}" changed the state.`)
      this.state = updatedState
      this.listeners.forEach(listener => listener(this.state))
    }
  }

  subscribe(listener: (state: S) => void) {
    this.listeners.push(listener)
    return this.unsubscribe.bind(this, listener)
  }

  unsubscribe(listener: (state: S) => void) {
    const index = this.listeners.indexOf(listener)
    this.listeners.splice(index, 1)
  }

  attachEffect(actionType: ActionType, effect: (action: Action, state: S, log: Logger) => Promise<S | null>) {
    this.effects[actionType] = effect
  }

  setState(state: S) {
    this.state = state
    this.listeners.forEach(listener => listener(this.state))
  }
}

/* TODO

- partial state update (location fetches the old state)?

*/
