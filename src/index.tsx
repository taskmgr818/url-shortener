import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { renderer } from './renderer'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
  KV: KVNamespace
}

const app = new Hono<{
  Bindings: Bindings
}>()

app.all('*', renderer)

const reservedKeys = new Set(['create', 'static'])

app.get('/:key{[A-Za-z0-9_-]{1,64}}', async (c) => {
  const key = c.req.param('key')
  const url = await c.env.KV.get(key)

  if (url === null) {
    return c.redirect('/')
  }

  return c.redirect(url)
})

app.get('/', (c) => {
  return c.render(
    <div>
      <h2>Create shorten URL!</h2>
      <form action="/create" method="post">
        <label for="url">Destination URL</label>
        <input
          id="url"
          type="url"
          name="url"
          required
          autocomplete="off"
          style={{
            width: '80%'
          }}
        />
        <label for="customKey">Custom short code (optional)</label>
        <input
          id="customKey"
          type="text"
          name="customKey"
          autocomplete="off"
          maxlength={64}
          pattern="[A-Za-z0-9_\-]{1,64}"
          placeholder="e.g. my-link"
          aria-describedby="custom-key-help"
        />
        <p id="custom-key-help">
          Use 1–64 letters, numbers, hyphens or underscores. Codes are case-sensitive.
          Leave blank to generate a random code. The codes "create" and "static" are reserved.
        </p>
        <button type="submit">Create</button>
      </form>
    </div>
  )
})

const schema = z.object({
  url: z.string().url(),
  customKey: z.string().trim()
    .max(64, 'Custom short codes must be at most 64 characters.')
    .refine(
      (key) => key === '' || /^[A-Za-z0-9_-]+$/.test(key),
      'Custom short codes may only contain letters, numbers, hyphens and underscores.'
    )
    .refine(
      (key) => !reservedKeys.has(key),
      'This short code is reserved. Please choose another.'
    )
    .optional()
})

const validator = zValidator('form', schema, (result, c) => {
  if (!result.success) {
    c.status(400)
    return c.render(
      <div>
        <h2>Error!</h2>
        <ul>
          {result.error.issues.map((issue) => <li>{issue.message}</li>)}
        </ul>
        <a href="/">Back to top</a>
      </div>
    )
  }
})

const createKey = async (kv: KVNamespace, url: string): Promise<string> => {
  const uuid = crypto.randomUUID()
  const key = uuid.substring(0, 6)
  const result = await kv.get(key)
  if (result === null) {
    await kv.put(key, url)
  } else {
    return await createKey(kv, url)
  }
  return key
}

app.post('/create', csrf(), validator, async (c) => {
  const { url, customKey } = c.req.valid('form')
  let key: string

  if (customKey) {
    const existingUrl = await c.env.KV.get(customKey)
    if (existingUrl !== null) {
      c.status(409)
      return c.render(
        <div>
          <h2>Short code already in use</h2>
          <p>Please choose another custom short code.</p>
          <a href="/">Back to top</a>
        </div>
      )
    }
    await c.env.KV.put(customKey, url)
    key = customKey
  } else {
    key = await createKey(c.env.KV, url)
  }

  const shortenUrl = new URL(`/${key}`, c.req.url)

  return c.render(
    <div>
      <h2>Created!</h2>
      <input
        type="text"
        value={shortenUrl.toString()}
        style={{
          width: '80%'
        }}
        autofocus
      />
    </div>
  )
})

export default app
