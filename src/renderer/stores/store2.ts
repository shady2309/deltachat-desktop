import { useState, useEffect, useLayoutEffect } from 'react'
import { getLogger, Logger } from '../../shared/logger'

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


export interface StoreListener<S>{
  onStateChange: (state: S) => void,
  onPushEffect: (a: Action) => void,
  onPushLayoutEffect: (a: Action) => void
}

export class Store<S> {
  private listeners: StoreListener<S>[] = []
  private effects: {[key: string]: EffectInterface<S>} = {}
  private _log: ReturnType<typeof getLogger>
  
  constructor(public state: S, name?: string) {
    if (!name) name = 'Store2'
    this._log = getLogger('renderer/stores/' + name)
  }

  private get log() {
    return this._log
  }

  getState() {
    return this.state
  }

  async dispatch(name: String, effect: (state: S) => Promise<S> | S): Promise<void> {
    this.log.debug('DISPATCH of type', name)
    const self = this
    await this.setState(async (state) => {
      const updatedState = await effect.call(self, state)
      if (updatedState !== this.state) {
        this.log.debug(
          `DISPATCHING of "${name}" changed the state. Before:`,
          this.state,
          'After:',
          updatedState
        )
        //this.log.debug(`DISPATCHING of "${effect.name}" changed the state.`)
      }
      return updatedState
    })
  }
  

  private subscribe(listener: StoreListener<S>) {
    this.listeners.push(listener)
    return this.unsubscribe.bind(this, listener)
  }

  private unsubscribe(listener: StoreListener<S>) {
    const index = this.listeners.indexOf(listener)
    this.listeners.splice(index, 1)
  }

  async setState(cb: (state: S) => Promise<S> | S) {
    const updatedState = await cb(this.state)
    if (!updatedState || updatedState === this.state) {
      this.log.info('setState: state didn\'t change')
      return
    }
    this.log.info('setState: state changed')
    this.state = updatedState
    for(let listener of this.listeners) {
      listener.onStateChange(this.state)
    }
  }
  
  async pushEffect(action: Action) {
    this.log.info('pushEffect: pushed effect ${action.type} ${action}')
    for(let listener of this.listeners) {
      listener.onPushEffect(action)
    }
  }

  async pushLayoutEffect(action: Action) {
    this.log.info('pushLayoutEffect: pushed layout effect ${action.type} ${action}')
    for(let listener of this.listeners) {
      listener.onPushLayoutEffect(action)
    }
  }

  useStore(onAction?: (action: Action) => void, onLayoutAction?: (action: Action) => void): S {
    const self = this
    console.log(self)
    const [state, setState] = useState(self.getState())
    const effectQueue: Action[] = []
    const layoutEffectQueue: Action[] = []

    useEffect(() => {
      return self.subscribe({
        onStateChange: setState,
        onPushEffect: (a) => effectQueue.push(a),
        onPushLayoutEffect: (a) => layoutEffectQueue.push(a)

      })
    }, [])
    
    useEffect(() => {
      let count = effectQueue.length;
      while (count > 0) {
        const action = effectQueue.pop()
        count--
        onAction(action)
      }      
    }, [state._rendererEffectActions])
    
    useLayoutEffect(() => {
      let count = layoutEffectQueue.length;
      while (count > 0) {
        const action = layoutEffectQueue.pop()
        count--
        onLayoutAction(action)
      }      
    }, [state._rendererEffectActions])

    return state
  }
}

/* TODO

- partial state update (location fetches the old state)?

*/
