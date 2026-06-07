# Events Duplicator

Aggregate multiple Google Calendars into a single destination calendar with automatic de-duplication and synchronization.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Calendar A  │     │  Calendar B  │     │  Calendar C  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │  Events Duplicator  │
                 │   (Apps Script)     │
                 └──────────┬──────────┘
                            ▼
                 ┌─────────────────────┐
                 │ Destination Calendar│
                 │                     │
                 │ "A, B: Shared Event"│
                 │ "C: Unique Event"   │
                 └─────────────────────┘
```

## Features

- **Multi-source aggregation** — Combine any number of calendars into one
- **Smart de-duplication** — Identical events across sources are merged with a combined prefix (e.g., `Dept A, Dept B: Colloquium`)
- **All-day event support** — Correctly handles single-day and multi-day all-day events
- **Live updates** — Changes to title, description, location, or time are synced automatically
- **Email reports** — Summary after each run with optional verbose debug logs
- **Concurrent-safe** — Script-level locking prevents race conditions
- **External calendar support** — Works with ICS feeds subscribed through Google Calendar

## Quick Start

1. **Create a new Apps Script project** at [script.google.com](https://script.google.com)
2. **Add two files** and paste contents from this repo:
   - `config.gs`
   - `gs-events-duplicator.gs`
3. **Configure** `config.gs` (see [Configuration](#configuration))
4. **Run** `copyNewEventsFromMultipleCalendars` and authorize when prompted
5. **Set up a trigger** for automatic sync (see [Scheduling](#scheduling))

## Configuration

Edit `config.gs` with your calendar IDs and preferences:

```js
// Source calendars: { 'Display Name': 'calendar_id' }
const sourceCalendars = {
  'Work': 'work@group.calendar.google.com',
  'Team': 'team_calendar@group.calendar.google.com',
  'Holidays': 'en.usa#holiday@group.v.calendar.google.com'
};

// Destination calendar ID
const destinationCalendarId = 'combined@group.calendar.google.com';

// Sync window: months back, months forward
const timeWindow = getTimeWindow(0, 2);  // Now through 2 months ahead

// Debug mode (verbose email logs)
var debug = false;

// Globally enable or disable synchronization without disabling the trigger
const enableSynchronization = true;

// Email recipients for sync reports
const emails = ['you@example.com'];
```

### Finding Calendar IDs

| Calendar Type | How to Find ID |
|---------------|----------------|
| **Your primary calendar** | Your email address (e.g., `you@gmail.com`) |
| **Calendars you created** | Calendar Settings → Integrate calendar → Calendar ID |
| **Shared calendars** | Calendar Settings → Integrate calendar → Calendar ID |
| **Public/Holiday calendars** | Usually formatted as `en.usa#holiday@group.v.calendar.google.com` |
| **ICS subscriptions** | After subscribing, find ID in Calendar Settings |

> **Tip:** In Google Calendar, click the three dots next to a calendar → Settings → scroll to "Integrate calendar" to find the Calendar ID.

## First Run

1. In Apps Script, select `copyNewEventsFromMultipleCalendars` from the function dropdown
2. Click **Run**
3. Authorize the requested permissions:
   - **Calendar** — Read from sources, write to destination
   - **Mail** — Send sync reports
4. Check your inbox for the summary email
5. Verify events appear in your destination calendar

## Scheduling

Set up automatic synchronization with a time-based trigger:

1. In Apps Script, click **Triggers** (clock icon in sidebar)
2. Click **Add Trigger**
3. Configure:
   - Function: `copyNewEventsFromMultipleCalendars`
   - Event source: **Time-driven**
   - Type: **Hour timer**
   - Interval: **Every 2 hours** (or your preference)
4. Click **Save**

## How It Works

1. **Fetch** — Retrieve events from each source calendar within the configured time window
2. **Deduplicate** — Group identical events (same title + start + end time) across sources
3. **Prefix** — Prepend source calendar names to titles (e.g., `Work, Team: Meeting`)
4. **Track** — Append `Source Event ID: <identifier>` to descriptions for matching
5. **Sync** — Create new events or update existing ones in the destination calendar
6. **Report** — Email a summary of all changes

## Configuration Tips

| Setting | Recommendation |
|---------|----------------|
| **Time window** | Keep minimal (e.g., 0–2 months) to reduce API calls and processing time |
| **Debug mode** | Enable temporarily (`debug = true`) for diagnostics; adds verbose logs to emails |
| **Enable sync** | Globally enable or disable synchronization (`enableSynchronization = true/false`) without disabling the trigger |
| **Source names** | Use short, recognizable names—they appear in event prefixes |
| **Sync frequency** | Every 2–4 hours balances freshness with quota usage |

## Behavior Details

### Event Matching

Events are considered identical if they share:
- **Title** (ignoring any existing calendar prefix)
- **Start time**
- **End time**

When the same event appears in multiple source calendars, the destination event title combines all sources: `Calendar A, Calendar B: Event Title`

### Identity Tracking

Each destination event includes `Source Event ID: <identifier>` in its description. This ID is used to:
- Find existing events for updates
- Avoid creating duplicates

### What Gets Synced

| Property | Synced? |
|----------|---------|
| Title | Yes (with prefix) |
| Start/End time | Yes |
| Description | Yes |
| Location | Yes |
| All-day status | Yes |
| Attendees | No |
| Reminders | No |
| Color | No |

### Concurrency

A script lock prevents overlapping runs. If a sync is already in progress, subsequent triggers are skipped.

## Known Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Time changes** | If a source event's time changes, a new identifier is generated. The old destination event remains as an orphan. | Manually delete orphans by searching `Source Event ID:` in the destination calendar |
| **Outside window** | Events moved outside the sync window aren't touched | Expand the window or wait for events to re-enter |
| **ICS delays** | Subscribed ICS feeds may have propagation delays | Destination reflects what Google Calendar shows at sync time |
| **API quotas** | Apps Script has daily limits | Reduce sources, narrow window, or decrease frequency |

## Troubleshooting

### "Calendar not found" in email
- Verify the Calendar ID is correct
- Ensure the account running the script has access to the calendar
- Check calendar sharing permissions

### Duplicate events appearing
- Usually caused by time changes in source events (see limitations)
- Search destination for `Source Event ID:` to find and remove orphans
- Consider narrowing the sync window

### All-day events showing as timed
- Source event must start at exactly 12:00 AM and end at 12:00 AM the next day
- Check the source calendar's timezone settings

### No email received
- Verify `emails` array in `config.gs`
- Check spam folder
- Confirm MailApp quota isn't exhausted (Apps Script → Quotas)

### Repeated authorization prompts
- Run the script from the same account that owns/has access to all calendars
- Re-authorize if permissions changed

## Recovery Procedure

If the destination calendar becomes inconsistent (orphaned events, duplicates, or sync failures), follow these steps:

1. **Remove orphaned/duplicate events** from the destination calendar:
   - Search for `Source Event ID:` in the destination calendar
   - Delete events that no longer correspond to source events
   - Or delete all synced events to start fresh (they will be recreated)

2. **Check and reset triggers** in Apps Script:
   - Go to **Triggers** (clock icon)
   - Delete any stuck or erroring triggers
   - Re-create the trigger for `copyNewEventsFromMultipleCalendars`

3. **Re-run the sync manually**:
   - Select `copyNewEventsFromMultipleCalendars` from the function dropdown
   - Click **Run** and re-authorize if prompted

4. **Redeploy the script** (if code is corrupted):
   - Create a new Apps Script project
   - Paste fresh copies of `config.gs` and `gs-events-duplicator.gs`
   - Reconfigure and set up triggers

Note: Source calendars are never modified. Recovery only affects the destination calendar and script configuration.

## Potential Enhancements

- [ ] Garbage collection for orphaned events after time changes
- [ ] Fuzzy matching to tolerate minor source edits
- [ ] Script Properties for externalized configuration
- [ ] Support for multiple destination calendars
- [ ] Configurable prefix format

## License

MIT
