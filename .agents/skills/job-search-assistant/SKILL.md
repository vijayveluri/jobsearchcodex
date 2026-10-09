---
name: job-search-assistant
description: Search, filter, and rank job listings against the candidate's CV and location preferences. Use when the user asks to find jobs, search a market, compare listings, or identify suitable openings.
---

# Job Search Assistant

Use this skill for targeted job searches in this repository.

## Candidate and search preferences

1. Read documents/cv/candidate_profile.md and the user's source CV in documents/cv/. Treat them as private factual data.
2. Read .claude/skills/job-scraper/search-queries.md for role, skill, and location priorities. Do not treat another user's example profile as this candidate's facts.
3. Inspect .agents/skills/*/SKILL.md and use only enabled portals. Follow each portal's documented CLI flags; do not guess command syntax.
4. Prefer public job-board APIs and official employer career pages. The included LinkedIn scraper warns automated access may conflict with LinkedIn's terms; prefer native LinkedIn alerts and do not invoke that scraper by default.

## Search execution

- The local Bun binary is .runtime/bin/bun.exe from the repository root. If it is missing, report that rather than installing software without the user's request.
- For this candidate's FreeHire searches, run Hyderabad and Middle East searches separately. Use --city Hyderabad alone for Hyderabad; use --region mena alone for a broad Middle East search. Do not combine city and region facets because the observed API results can mix locations. Check each result's actual location.
- Use focused role queries such as site reliability engineer, SRE manager, cloud infrastructure, platform engineering, and AIOps observability.
- Keep a sensible recency window and result limit. If a source is unreachable, say so and continue with available sources.
- Do not run searches in bulk or repeatedly without a user request.

## Ranking and reporting

- Deduplicate reposts where possible and flag stale, missing-location, or suspicious region metadata.
- Do not assign a meaningful fit score from title alone. Retrieve the full posting for promising roles, compare its requirements with the CV, and label scores as evidence-based estimates rather than hiring probabilities.
- Show location, employer, role, posting date, source link, main match evidence, documented gaps, and uncertainty.
- Do not apply, message recruiters, or share candidate documents.
