type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown | BodyInit;
};

function isBodyInit(value: unknown): value is BodyInit {
  return value instanceof FormData
    || value instanceof Blob
    || value instanceof URLSearchParams
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || (typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
    || typeof value === "string";
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body: requestBody, headers: optionHeaders, ...fetchOptions } = options;
  const isNativeBody = isBodyInit(requestBody);
  const headers = new Headers(optionHeaders);
  const body: BodyInit | undefined = requestBody === undefined
    ? undefined
    : isNativeBody
      ? requestBody
      : JSON.stringify(requestBody);

  if (requestBody !== undefined && !isNativeBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "include",
    ...fetchOptions,
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Request failed: ${response.status}`);
  }
  return data as T;
}
