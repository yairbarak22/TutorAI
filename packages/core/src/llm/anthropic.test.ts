import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { setLanguage } from "@ruecai/sdk";
import { LLMError, toLLMError } from "./anthropic.ts";

describe("toLLMError", () => {
  it("maps 402 PaymentRequiredError to a budget_limit message mentioning console.anthropic.com", () => {
    setLanguage("en");
    const err = toLLMError(new Anthropic.PaymentRequiredError(402, { message: "payment required" }, "payment required", new Headers()));
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe("budget_limit");
    expect(err.message).toContain("console.anthropic.com");
    expect(err.message.toLowerCase()).toContain("demo mode");

    setLanguage("he");
    const he = toLLMError(new Anthropic.PaymentRequiredError(402, { message: "payment required" }, "payment required", new Headers()));
    expect(he.kind).toBe("budget_limit");
    expect(he.message).toContain("console.anthropic.com");
  });

  it("maps 429 RateLimitError to a helpful rate_limit or budget_limit message with console link", () => {
    setLanguage("en");
    const rate = toLLMError(new Anthropic.RateLimitError(429, { message: "rate limited" }, "rate limited", new Headers()));
    expect(rate.kind).toBe("rate_limit");
    expect(rate.message).toContain("console.anthropic.com");
    expect(rate.message.toLowerCase()).toContain("demo mode");

    const spend = toLLMError(
      new Anthropic.RateLimitError(429, { message: "Monthly spend limit reached" }, "Monthly spend limit reached", new Headers()),
    );
    expect(spend.kind).toBe("budget_limit");
    expect(spend.message).toContain("console.anthropic.com");
  });

  it("maps credit exhaustion 400 BadRequestError to budget_limit", () => {
    setLanguage("en");
    const credit = toLLMError(
      new Anthropic.BadRequestError(400, { message: "Your credit balance is too low to access the Anthropic API." }, "Your credit balance is too low to access the Anthropic API.", new Headers()),
    );
    expect(credit.kind).toBe("budget_limit");
    expect(credit.message).toContain("console.anthropic.com");
  });
});
