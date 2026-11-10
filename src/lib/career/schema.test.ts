import { zodResponseFormat } from "openai/helpers/zod";
import { expect, it } from "vitest";
import { careerAiAnswerSchema, careerPreferencesSchema } from "./schema";

it("serializes every interview/coach proposal through the real strict OpenAI SDK formatter", () => {
  expect(() => zodResponseFormat(careerAiAnswerSchema, "career_conversation")).not.toThrow();
  const schema = zodResponseFormat(careerAiAnswerSchema, "resume_coach");
  expect(schema.type).toBe("json_schema");
  expect(schema.json_schema.strict).toBe(true);
  // Older reviewed preferences remain readable without the new transport field.
  const query = careerPreferencesSchema.shape.searches.element.shape.query;
  expect(query.safeParse({ keywords: "Engineer", place: "", country: "", radiusKm: 25, remoteOnly: false, postedWithin: "any" }).success).toBe(true);
});
