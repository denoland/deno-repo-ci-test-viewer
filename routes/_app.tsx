import { define } from "@/define.ts";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Deno CI Test Viewer</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
