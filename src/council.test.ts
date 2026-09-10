import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCouncilVotes, parseCouncilVote, type CouncilVote } from "./council.js";

function vote(status: CouncilVote["status"], allowResume: boolean, summary = status): CouncilVote {
  return {
    status,
    allowResume,
    summary,
    risks: [],
    blockers: allowResume ? [] : ["human decision required"],
    next: ["review current task"],
    evidence: ["GitHub state"],
  };
}

test("parses a strict council JSON vote", () => {
  const parsed = parseCouncilVote(JSON.stringify({
    status: "YELLOW",
    allow_resume: true,
    summary: "Safe with caution",
    risks: ["stale branch"],
    blockers: [],
    next: ["run tests"],
    evidence: ["open PR #12"],
  }));
  assert.equal(parsed.status, "YELLOW");
  assert.equal(parsed.allowResume, true);
  assert.deepEqual(parsed.next, ["run tests"]);
});

test("rejects malformed or incomplete votes", () => {
  assert.throws(() => parseCouncilVote("not-json"), /JSON/);
  assert.throws(() => parseCouncilVote('{"status":"BLUE","allow_resume":true}'), /status/);
  assert.throws(() => parseCouncilVote('{"status":"GREEN"}'), /allow_resume/);
});

test("GREEN requires all three final votes to allow resume", () => {
  const result = aggregateCouncilVotes([vote("GREEN", true), vote("GREEN", true), vote("GREEN", true)]);
  assert.equal(result.status, "GREEN");
  assert.equal(result.allowResume, true);
});

test("YELLOW can resume only when all three explicitly allow it", () => {
  const result = aggregateCouncilVotes([vote("GREEN", true), vote("YELLOW", true), vote("GREEN", true)]);
  assert.equal(result.status, "YELLOW");
  assert.equal(result.allowResume, true);
});

test("one RED or deny vote blocks the resume gate", () => {
  const red = aggregateCouncilVotes([vote("GREEN", true), vote("RED", false), vote("GREEN", true)]);
  assert.equal(red.status, "RED");
  assert.equal(red.allowResume, false);

  const deny = aggregateCouncilVotes([vote("GREEN", true), vote("YELLOW", false), vote("GREEN", true)]);
  assert.equal(deny.status, "RED");
  assert.equal(deny.allowResume, false);
});
