import { describe, expect, test } from "bun:test";
import { createDefaultDependencies } from "./providers";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("createDefaultDependencies geocode provider", () => {
  test("requests Nominatim namedetails and maps English aliases", async () => {
    const seenUrls: URL[] = [];
    const fetchImpl = Object.assign(
      async (input: RequestInfo | URL) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(href);
        seenUrls.push(url);

        if (url.hostname === "nominatim.openstreetmap.org" && url.pathname === "/search") {
          return jsonResponse([
            {
              place_id: 1,
              lat: "64.1814",
              lon: "-51.6941",
              addresstype: "country",
              display_name: "Kalaallit Nunaat",
              address: {
                country: "Kalaallit Nunaat",
                country_code: "gl",
              },
              namedetails: {
                name: "Kalaallit Nunaat",
                "name:en": "Greenland",
              },
            },
          ]);
        }

        return new Response("not found", { status: 404 });
      },
      {
        preconnect() {},
      },
    ) as typeof fetch;

    const deps = createDefaultDependencies({
      fetchImpl,
      userAgent: "time-in-place/test",
      now: () => 1_700_000_000_000,
    });

    const results = await deps.geocodeProvider.search("greenland");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Kalaallit Nunaat");
    expect(results[0]?.englishName).toBe("Greenland");

    const searchUrl = seenUrls.find(url => url.hostname === "nominatim.openstreetmap.org" && url.pathname === "/search");
    expect(searchUrl).toBeDefined();
    expect(searchUrl?.searchParams.get("namedetails")).toBe("1");
  });
});
