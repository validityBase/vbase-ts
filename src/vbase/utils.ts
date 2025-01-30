/**
 * Recursively serializes BigInt values within an object, array, or nested structure.
 *
 * This function converts all `bigint` values to their string representation with an `"n"` suffix,
 * ensuring compatibility with JSON serialization or systems that do not support native BigInts.
 *
 * @param {any} obj - The object, array, or value that may contain BigInt values.
 *
 * @returns {any} A new object, array, or value where all BigInts have been converted to strings.
 */
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

/**
 * Converts an object into a pretty-printed JSON string.
 *
 * This function is useful for logging and debugging by formatting objects
 * with indentation for better readability.
 *
 * @param {any} obj - The object to be converted into a formatted JSON string.
 *
 * @returns {string} A JSON-formatted string with indentation for readability.
 */
// This is a general function operating on a variety of objects.
// Disable warning for obj: any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonPrettyStringify(obj: any): string {
  return JSON.stringify(obj, null, 2);
}
