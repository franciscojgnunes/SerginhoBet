# SerginhoEsteves PickRoom MVP Design

## Summary

PickRoom is a social football prediction platform for the Twitch community of SerginhoEsteves. Viewers log in with Twitch, see upcoming football matches imported automatically, submit picks with manually entered odds, vote on community picks, and follow a daily community bet slip. The product tracks fictitious units, ROI, win rate, and leaderboard performance without accepting money or operating as a bookmaker.

The MVP is scoped to one streamer, SerginhoEsteves, and football only. It should feel like a community prediction and reputation layer around the stream, not a real-money betting product.

## Goals

- Let viewers submit and discuss football picks tied to real upcoming matches.
- Import match fixtures and final scores automatically from a free football data API.
- Let users enter odds manually, avoiding dependency on paid or fragile odds APIs in V1.
- Generate a daily community slip based on votes and author reputation.
- Track user performance in fictitious units, including profit, ROI, win rate, and pick count.
- Give SerginhoEsteves and trusted moderators tools to settle non-automatic markets and manage the community.
- Keep the architecture ready for future multi-streamer support without building full SaaS management in the MVP.

## Non-Goals

- No real-money deposits, withdrawals, pooled funds, betting execution, cashout, or bookmaker operation.
- No paid odds integration in the MVP.
- No Twitch chat bot, overlay, Discord notifications, or command-based pick submission in the MVP.
- No multi-streamer onboarding UI in the MVP.
- No automatic settlement for complex markets beyond the initial supported market types.
- No guarantee of profitability or betting advice positioning.

## Target Users

### Viewer

A Twitch viewer in SerginhoEsteves' community who wants to submit football picks, vote on other picks, and compare performance with other viewers.

### Moderator

A trusted community member who helps review picks, settle markets that cannot be resolved automatically, and keep the community clean.

### Streamer/Admin

SerginhoEsteves or an appointed admin. They can manage settings, resolve disputes, control daily slip rules, and oversee rankings.

## Product Scope

The first release supports one community: SerginhoEsteves. Internally, data should include a `streamer_id` or equivalent community boundary so later multi-streamer support can be added without redesigning every table.

The MVP supports football only, starting with Primeira Liga fixtures. The first provider should be `football-data.org` because it has a free tier with Primeira Liga coverage. The provider integration must be isolated behind a backend interface so another API can be added later.

Odds are entered manually by users or admins. A pick records the bookmaker/source as text, for example Betano, Betclic, Solverde, or Manual. The platform stores the submitted odd as the value used for performance tracking.

## Core User Flows

### Twitch Login

Users authenticate with Twitch OAuth using Authorization Code Flow. On first login, the backend stores Twitch identity data and creates a viewer profile.

Stored user fields:

- Twitch user id
- Display name
- Avatar URL
- Email, only if the selected Twitch scope includes it
- Role: viewer, mod, streamer, or admin
- Created and last login timestamps

### Browse Matches

The app shows upcoming football matches imported by scheduled jobs. For V1, the main match list should prioritize Primeira Liga, with optional later expansion to Champions League or other top competitions if the provider supports them.

Each match displays teams, competition, kickoff time, status, final score when available, and number of community picks.

### Submit Pick

A logged-in viewer creates a pick for a match.

Required fields:

- Match
- Market type: 1X2, Over/Under, BTTS, Handicap, or Other
- Selection
- Decimal odd
- Stake in units
- Bookmaker/source
- Reason

Validation:

- Odd must be greater than 1.00.
- Stake must be positive and should default to 1 unit.
- Match must not have started.
- A user may have a configurable maximum number of pending picks per match and per day.
- Reason should have a minimum length to discourage empty spam.

### Vote on Picks

Logged-in users can vote on picks from other users.

Vote types:

- Trust
- Doubt
- Strong pick

A user can only have one active vote per pick. Changing vote replaces the previous vote. Self-voting is not allowed.

### Daily Community Slip

The system generates one daily community slip for SerginhoEsteves. It selects eligible picks based on:

- Match kickoff date
- Vote score
- Author reputation
- Minimum number of votes
- Market eligibility
- Maximum picks per slip
- Optional odd range

Initial score formula:

```txt
score = trust_votes - doubt_votes + (strong_pick_votes * 2) + author_reputation_weight
```

The daily slip should be editable by admin/mod before publication. Once published, it becomes visible as the official community slip for that date.

### Settlement

The system syncs final scores from the sports data provider. It automatically settles only 1X2 picks:

- Home win selection wins if home score is greater than away score.
- Draw selection wins if scores are equal.
- Away win selection wins if away score is greater than home score.

All other market types remain pending until settled manually by admin/mod.

Settlement statuses:

- pending
- won
- lost
- void
- half_won
- half_lost

Profit calculation:

```txt
won: stake * (odd - 1)
lost: -stake
void: 0
half_won: stake * (odd - 1) / 2
half_lost: -stake / 2
```

ROI:

```txt
roi = profit / settled_stake
```

Only settled picks count toward leaderboard performance.

### Leaderboard and Profiles

Leaderboards show:

- Total profit
- ROI
- Win rate
- Settled pick count
- Best winning odd
- Weekly and monthly top viewer

To reduce noisy rankings, leaderboard entries should require a minimum settled pick count. Profiles show all submitted picks, current pending picks, settled results, cumulative profit, ROI, and win rate.

## Roles and Permissions

### Viewer

- Log in with Twitch.
- View matches, picks, slip, leaderboard, and profiles.
- Submit picks.
- Vote on picks.
- View own performance.

### Moderator

All viewer permissions plus:

- Settle non-automatic picks.
- Mark invalid or duplicate picks.
- Help publish or adjust the daily slip if allowed by admin settings.

### Streamer/Admin

All moderator permissions plus:

- Manage community settings.
- Manage user roles.
- Configure daily slip rules.
- Trigger or inspect fixture sync jobs.
- Resolve disputed settlements.

## Data Model

### streamers

- id
- twitch_user_id
- channel_name
- display_name
- created_at

### users

- id
- twitch_id
- display_name
- avatar_url
- email
- role
- created_at
- last_login_at

### streamer_users

- id
- streamer_id
- user_id
- role_override
- joined_at

### competitions

- id
- provider
- provider_competition_id
- code
- name
- country
- sport

### teams

- id
- provider
- provider_team_id
- name
- short_name
- crest_url

### matches

- id
- streamer_id
- provider
- provider_match_id
- competition_id
- home_team_id
- away_team_id
- starts_at
- status
- home_score
- away_score
- last_synced_at

### picks

- id
- streamer_id
- user_id
- match_id
- market_type
- selection
- odds
- stake
- bookmaker
- reason
- status
- profit
- auto_settle_eligible
- created_at
- settled_at
- settled_by_user_id

### votes

- id
- pick_id
- user_id
- vote_type
- created_at
- updated_at

### daily_slips

- id
- streamer_id
- slip_date
- status
- total_odds
- generated_at
- published_at
- published_by_user_id

### daily_slip_items

- id
- daily_slip_id
- pick_id
- rank
- score_at_generation

### user_stats

- id
- streamer_id
- user_id
- settled_pick_count
- won_pick_count
- lost_pick_count
- void_pick_count
- total_staked
- total_profit
- roi
- win_rate
- best_winning_odd
- updated_at

## Backend Architecture

Use FastAPI as the API backend.

Core modules:

- Auth: Twitch OAuth, session/JWT handling, role enforcement.
- Sports data provider: imports competitions, teams, fixtures, and final scores.
- Picks: create, validate, list, and settle picks.
- Votes: vote creation and score aggregation.
- Slip generation: daily candidate scoring, generation, editing, and publishing.
- Stats: user performance aggregation and leaderboard queries.
- Admin: role management, settlement tools, sync status, and settings.

The sports data integration should be defined through an internal provider contract:

```txt
list_competitions()
sync_matches(competition_code, date_from, date_to)
sync_match_result(provider_match_id)
```

The first implementation uses football-data.org. If provider limits are reached, the app should degrade gracefully and keep manual admin workflows usable.

## Jobs

Scheduled jobs:

- Import upcoming matches daily.
- Refresh today's matches more frequently.
- Sync final scores after matches.
- Generate draft daily slip each morning.
- Recalculate user stats after settlement.

Manual admin triggers:

- Run fixture sync.
- Run result sync.
- Regenerate daily slip draft.
- Recalculate leaderboard.

## Frontend Architecture

Use Next.js for the web app.

Core pages:

- `/` community dashboard for SerginhoEsteves
- `/login` Twitch login entry
- `/matches` upcoming matches
- `/matches/[id]` match detail and picks
- `/picks/new?matchId=...` create pick
- `/slip/today` daily community slip
- `/leaderboard` rankings
- `/users/[id]` viewer profile
- `/admin` admin/mod tools

The UI should be practical and community-focused. It should prioritize upcoming matches, top picks, daily slip status, and leaderboard movement. It should avoid looking like a sportsbook checkout or real-money betting interface.

## API Surface

Initial backend endpoints:

- `GET /api/me`
- `GET /api/auth/twitch/login`
- `GET /api/auth/twitch/callback`
- `POST /api/auth/logout`
- `GET /api/matches`
- `GET /api/matches/{match_id}`
- `GET /api/matches/{match_id}/picks`
- `POST /api/picks`
- `GET /api/picks/{pick_id}`
- `POST /api/picks/{pick_id}/votes`
- `DELETE /api/picks/{pick_id}/votes`
- `GET /api/slips/today`
- `POST /api/admin/slips/generate`
- `POST /api/admin/slips/{slip_id}/publish`
- `POST /api/admin/picks/{pick_id}/settle`
- `GET /api/leaderboard`
- `GET /api/users/{user_id}/stats`
- `POST /api/admin/sync/matches`
- `POST /api/admin/sync/results`

## Error Handling

- Provider API errors should be logged and surfaced in admin sync status, not shown as raw failures to viewers.
- If match sync fails, existing matches remain visible.
- If result sync fails, picks remain pending until the next sync or manual settlement.
- If Twitch OAuth fails, users return to login with a readable error.
- Duplicate votes and invalid self-votes return clear validation errors.
- Manual settlement actions should be auditable and reversible by admin where practical.

## Compliance and Responsible Use

The app must consistently position itself as social prediction tracking with fictitious units.

Required product copy:

- No real-money betting is available on the platform.
- Units are fictitious and used only for community ranking.
- The platform does not guarantee profits or provide financial advice.
- Users should follow local laws and gamble responsibly if they choose to use external bookmakers.

Avoid:

- Deposit, withdrawal, wallet, cashout, or balance terminology that suggests real funds.
- Calls to action that push users to place real bets.
- Affiliate bookmaker links in the MVP.

## Testing Strategy

Backend tests:

- Twitch auth callback handling with mocked provider responses.
- Pick creation validation.
- Vote replacement and self-vote prevention.
- Daily slip scoring and max-pick constraints.
- 1X2 auto-settlement from final scores.
- Profit, ROI, win rate, and leaderboard calculations.
- Sports provider adapter with mocked API responses and rate-limit failures.

Frontend tests:

- Login state rendering.
- Match list and match detail views.
- Pick creation form validation.
- Vote controls.
- Daily slip display states: draft, published, empty.
- Leaderboard minimum-pick filtering.
- Admin settlement form.

End-to-end smoke tests:

- Login as mocked Twitch user.
- Browse imported match.
- Submit pick.
- Vote from another user.
- Generate slip.
- Settle pick.
- Confirm leaderboard updates.

## MVP Acceptance Criteria

- A Twitch user can log in and see their profile identity in the app.
- Upcoming Primeira Liga matches are imported automatically and visible in the match list.
- A viewer can submit a pick with manual odds for an upcoming match.
- Other viewers can vote on picks, with one active vote per user per pick.
- The system can generate a daily slip from eligible picks.
- Admin/mod can publish the daily slip.
- Final scores can be synced from the provider.
- 1X2 picks are settled automatically from final scores.
- Other picks can be settled manually by admin/mod.
- User stats and leaderboard update after settlement.
- The app displays clear fictitious-unit and responsible-use disclaimers.

## Roadmap

### V2

- Twitch chat bot commands: `!pick`, `!boletim`, `!rank`, `!roi`.
- Stream overlay for the daily slip and leaderboard.
- Discord notifications when a slip is published.
- Reputation system with badges.
- Additional competitions beyond Primeira Liga.
- Optional odds API integration with strict caching and manual fallback.

### V3

- Multi-streamer SaaS onboarding.
- Private leagues per streamer.
- Weekly competitions and seasonal leaderboards.
- Subscription-only community features.
- Public API for overlays and community widgets.
- Advanced analytics by market, team, odds range, and competition.

## Open Implementation Decisions

- Exact Twitch scopes should be finalized during implementation. Email is optional and should only be requested if needed.
- The first production deployment target can be VPS with Docker Compose unless a managed platform is preferred.
- The exact free sports data provider account and API key management process should be chosen before implementation starts.
- Daily slip limits should start with conservative defaults: 3 to 5 picks per day, minimum 3 votes per pick, stake default 1 unit.
