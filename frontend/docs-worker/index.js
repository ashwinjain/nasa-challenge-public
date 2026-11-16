// Search the project docs index; called only by the Pages app over a
// service binding (no public URL). Body: { query, max_num_results }.
export default {
  async fetch(request, env) {
    const { query, max_num_results = 4 } = await request.json();
    const res = await env.DOCS.get(env.AI_SEARCH_NAME).search({ query, max_num_results });
    return Response.json(res);
  },
};
