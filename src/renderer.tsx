import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children, title }) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/static/bitnp-logo.png" />
        <link href="/static/style.css" rel="stylesheet" />
        <title>{title || '短链接'}</title>
      </head>
      <body>
        <header>
          <h1>
            <a class="brand" href="/">
              <img src="/static/bitnp-logo.png" width="36" height="36" alt="" />
              <span>BITNP</span>
            </a>
          </h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
})
