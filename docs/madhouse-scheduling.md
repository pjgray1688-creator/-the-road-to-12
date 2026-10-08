# Madhouse shared scheduling

The shared staff calendar is an operational view over the existing `club_class_sessions` / `club_class_bookings` model plus `club_schedule_events` for PT appointments and staff time blocks. Class capacity and bookings continue to use the existing class domain; PT package credits are intentionally not consumed.

Staff calendar reads are organisation-scoped and expose the operational schedule to authorised Club staff and trainers. Internal notes are returned only to the PT who owns the item and owner/admin roles. Members use `club_list_my_schedule`, which returns only their linked PT appointments and confirmed class bookings, and has no private-note field. Unlinked imported customers remain bookable by staff but cannot receive member notifications until linked to an R12 account.

`classes.manage` remains the capability boundary. Trainers can create and edit their own PT sessions and staff blocks; reception/Club staff can manage appointments on behalf of members; owner/admin can manage all. Class creation and class booking continue through the existing class workspace and RPC permissions.

The database serialises each staff member's conflict check with a transaction advisory lock, then checks overlapping scheduled PT/block events and hosted class sessions. Existing class writes run the same check from a database trigger, so class/PT and cross-location conflicts are rejected even for concurrent writes. Cancelled items do not block time. Conflicts are returned as a human-readable save error.

Linked members receive a transactional `schedule_update` intent through the existing notification outbox on PT booking/material changes and class booking/material event changes. The same intent rows are surfaced in the member's Schedule screen through a user-scoped RPC and can be marked seen; the existing configured outbound delivery worker also handles delivery. Irrelevant staff-note edits do not notify. No second notification system is introduced.

Classes remain associated through confirmed bookings; member self-booking is not added or modified. Future recurring availability can be added as generated event instances, class waitlists can extend the existing booking model, and PT credits can link from completed PT events when a real package entitlement model is introduced.

All instants are stored as `timestamptz` and presented in `Europe/London`. The schedule editor interprets its local date/time fields as UK wall time, including daylight-saving offsets.

Coach working hours are one recurring row per ISO weekday, stored as UK local `time` values rather than generated events. Coaches edit their own hours; authorised owners/managers can manage the team. The calendar shows the selected day's usual hours, while scheduled leave, blocks, classes and appointments remain the actual diary. New PT appointments must fit wholly within one day's normal hours; only an owner/admin with `classes.manage` can explicitly override, with a reason stored on the event and in the audit log.

Private PT clients use an organisation-scoped lightweight person record with a stable UUID and display name, separate from Auth, Member and membership records. An event refers to either an existing R12 customer or a private client. Only the assigned Coach and authorised operational staff see a private client's name; colleagues see an occupied generic PT slot, and private contact details are not collected. The nullable canonical-customer link preserves a clean future linking path without changing event history. Private clients never enter Member schedule results or notification delivery.
