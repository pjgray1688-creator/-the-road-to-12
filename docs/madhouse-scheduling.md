# Madhouse shared scheduling

The shared staff calendar is an operational view over the existing `club_class_sessions` / `club_class_bookings` model plus `club_schedule_events` for PT appointments and staff time blocks. Class capacity and bookings continue to use the existing class domain; PT package credits are intentionally not consumed.

Staff calendar reads are organisation-scoped and expose the operational schedule to authorised Club staff and trainers. Internal notes are returned only to the PT who owns the item and owner/admin roles. Members use `club_list_my_schedule`, which returns only their linked PT appointments and confirmed class bookings, and has no private-note field. Unlinked imported customers remain bookable by staff but cannot receive member notifications until linked to an R12 account.

`classes.manage` remains the capability boundary. Trainers can create and edit their own PT sessions and staff blocks; reception/Club staff can manage appointments on behalf of members; owner/admin can manage all. Class creation and class booking continue through the existing class workspace and RPC permissions.

The database serialises each staff member's conflict check with a transaction advisory lock, then checks overlapping scheduled PT/block events and hosted class sessions. Existing class writes run the same check from a database trigger, so class/PT and cross-location conflicts are rejected even for concurrent writes. Cancelled items do not block time. Conflicts are returned as a human-readable save error.

Linked members receive a transactional `schedule_update` intent through the existing notification outbox on PT booking/material changes and class booking/material event changes. The same intent rows are surfaced in the member's Schedule screen through a user-scoped RPC and can be marked seen; the existing configured outbound delivery worker also handles delivery. Irrelevant staff-note edits do not notify. No second notification system is introduced.

Classes remain associated through confirmed bookings; member self-booking is not added or modified. Future class waitlists can extend the existing booking model, and PT credits can link from completed PT events when a real package entitlement model is introduced.

Appointments and class instants are stored as `timestamptz` and presented in `Europe/London`. Rota shifts store a UK `work_date` plus local start/end times as wall-clock values. The schedule editor interprets local date/time fields using UK daylight-saving rules.

The calendar keeps three distinct records. Gym rota shifts record staffed Madhouse hours for a named staff member, UK date/time and an existing Madhouse location. Only an owner/admin with `classes.manage` may create, edit, move or cancel rota shifts; staff can see their own shifts, while management can see the full rota. Rota shifts are reportable and audited, but are deliberately absent from appointment conflict checks.

PT availability is the Coach's own diary: explicit unavailable, other-gym/location, personal/admin and approved-leave blocks. A Coach can manage their own diary blocks. Recurring weekly availability in `club_staff_weekly_working_hours` is retained as an optional planning guide in Europe/London wall time. **No rota hours / no availability configuration does not prevent PT bookings.** Bookings can also be outside the guide; only actual diary conflicts can block them.

Holiday/leave is requested by the staff member and visible only to them and authorised management while pending. Pending requests do not block time. An authorised owner/admin can approve or decline; approval transactionally creates a scheduled leave block after the same conflict check used by appointments/classes. The requester or management can cancel a request; an approved leave block is cancelled too. Request, review and cancellation actions retain actor/timestamp history.

Hard diary conflicts remain concurrency-safe across PT appointments, classes, unavailable blocks, approved leave, other-gym commitments and personal/admin blocks. Rota shifts are not conflicts: a PT session may occur during or outside a rota shift. PT appointment records continue to retain the delivering Coach, actual Madhouse location, client, time, status and notes for management reporting.

Private PT clients use an organisation-scoped lightweight person record with a stable UUID and display name, separate from Auth, Member and membership records. An event refers to either an existing R12 customer or a private client. Only the assigned Coach and authorised operational staff see a private client's name; colleagues see an occupied generic PT slot, and private contact details are not collected. The nullable canonical-customer link preserves a clean future linking path without changing event history. Private clients never enter Member schedule results or notification delivery.
