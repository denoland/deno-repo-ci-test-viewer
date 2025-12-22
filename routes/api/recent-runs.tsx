import { define } from "@/app.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const runsFetcher = await ctx.state.store.get("runsFetcher");
    const url = new URL(ctx.req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const perPage = parseInt(url.searchParams.get("per_page") || "30", 10);

    const result = await runsFetcher.fetchRecentRuns(perPage, page);

    return Response.json(result);
  },
});
