import { fake } from './supabase'

/** 假的 web-push：不发，只记下来发给了谁、发了什么 */
export default {
  setVapidDetails() {},
  async sendNotification(sub: { endpoint: string }, payload: string) {
    fake.pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
  },
}
