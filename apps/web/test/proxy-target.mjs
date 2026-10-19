export function proxyTarget(requestUrl, baseUrl) {
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//") ||
    /[a-z][a-z0-9+.-]*:|[\\\s#]/i.test(requestUrl)
  )
    throw new Error("Invalid proxy request target");
  const base = new URL(baseUrl);
  const target = new URL(base.href);
  const query = requestUrl.indexOf("?");
  target.pathname = query < 0 ? requestUrl : requestUrl.slice(0, query);
  target.search = query < 0 ? "" : requestUrl.slice(query);
  target.hash = "";
  if (target.origin !== base.origin) throw new Error("Proxy origin mismatch");
  return target;
}
