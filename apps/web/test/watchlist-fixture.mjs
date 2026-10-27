import { randomUUID } from "node:crypto";

const users = new Map();
export async function watchlistFixture(request, path, send, user, instrument, instant) {
  if (!path.startsWith("/market/watchlists")) return false;
  if (!users.has(user)) users.set(user, []);
  const lists = users.get(user);
  if (user === "fixture-perf" && lists.length === 0)
    lists.push({
      id: "01900000-0000-7000-8000-000000000106",
      name: "Lista syntetyczna",
      position: 0,
      itemCount: 0,
      createdAt: instant,
      updatedAt: instant,
      items: [],
    });
  let text = "";
  if (request.method !== "GET") for await (const chunk of request) text += chunk;
  const data = text ? JSON.parse(text) : {};
  const [, , , id, , instrumentId] = path.split("/");
  const list = lists.find((item) => item.id === id);
  if (!id) {
    if (request.method === "POST") {
      const item = {
        id: randomUUID(),
        name: data.name,
        position: lists.length,
        itemCount: 0,
        createdAt: instant,
        updatedAt: instant,
        items: [],
      };
      lists.push(item);
      const { items: _, ...result } = item;
      return send(result, 201);
    }
    return send({ data: lists.map(({ items: _, ...item }) => item) });
  }
  if (!list) return send({ code: "NOT_FOUND", status: 404 }, 404);
  const itemsPath = path.includes("/items");
  if (request.method === "GET") return send(list);
  if (!itemsPath) {
    if (request.method === "DELETE") {
      lists.splice(lists.indexOf(list), 1);
      return send(undefined, 204);
    }
    if (data.name) list.name = data.name;
    if (data.position !== undefined) {
      lists.splice(lists.indexOf(list), 1);
      lists.splice(data.position, 0, list);
      lists.forEach((item, index) => {
        item.position = index;
      });
    }
    const { items: _, ...result } = list;
    return send(result);
  }
  if (request.method === "POST") {
    const item = {
      instrument,
      position: list.items.length,
      addedAt: instant,
      note: data.note,
      quote: {
        instrumentId: instrument.id,
        price: "12",
        currency: "PLN",
        changeRatio: -0.02,
        meta: { source: "gpw", asOf: instant, delayMinutes: 0, stale: false },
      },
    };
    list.items.push(item);
    list.itemCount = list.items.length;
    return send(item, 201);
  }
  const item = list.items.find((item) => item.instrument.id === instrumentId);
  if (!item) return send({ code: "NOT_FOUND", status: 404 }, 404);
  if (request.method === "DELETE") {
    list.items.splice(list.items.indexOf(item), 1);
    list.itemCount = list.items.length;
    return send(undefined, 204);
  }
  if (data.note !== undefined) item.note = data.note ?? undefined;
  if (data.position !== undefined) {
    list.items.splice(list.items.indexOf(item), 1);
    list.items.splice(data.position, 0, item);
    list.items.forEach((row, index) => {
      row.position = index;
    });
  }
  return send(item);
}
