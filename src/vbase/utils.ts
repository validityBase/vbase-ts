// This is a general function operating on a variety of objects.
// Disable warning for obj: any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeBigInts(obj: any): any {
  // If the object is a bigint, return its string representation.
  if (typeof obj === "bigint") {
    return obj.toString() + "n";
  }

  // If the object is an array, recursively process each element.
  if (Array.isArray(obj)) {
    return obj.map((value) => serializeBigInts(value));
  }

  // If the object is a plain object, recursively process each key-value pair.
  if (typeof obj === "object" && obj !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = serializeBigInts(obj[key]);
      }
    }
    return result;
  }

  // If the object is neither a bigint, an array, nor a plain object, return it as is.
  return obj;
}

// This is a general function operating on a variety of objects.
// Disable warning for obj: any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonPrettyStringify(obj: any): string {
  return JSON.stringify(obj, null, 2);
}
