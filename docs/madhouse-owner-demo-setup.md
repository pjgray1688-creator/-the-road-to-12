# Madhouse owner demo setup

This is a reviewed, non-executing checklist. It intentionally contains no production credentials or guessed user IDs.

## Peter — Golden Ticket

Use the authorised Club membership assignment flow for the existing Peter Gray person/account. Select the existing Golden Ticket product (one-off £500, lifetime, organisation/future-location access) and confirm the real start date and induction policy. Do not create a duplicate product or fabricate payment state.

## Keenan — Owner / Manager

Confirm Keenan’s authenticated Supabase user ID from the organisation’s active staff membership, then ensure that membership retains the `owner` role. The UI may display “Owner / Manager”; the security role remains `owner`.

## Demo Staff

Create or invite a clearly labelled `Demo Staff` authenticated user through the supported account/invitation flow, then add that user as active `gym_staff`. Use Staff → Manage permissions to demonstrate explicit allow/deny overrides. Never invent a UUID or shared login.

## Verification

Verify the person/account link, Golden Ticket membership validity and all-location entitlement, active owner membership, and Demo Staff capability resolution in the Club UI. No SQL is supplied because the required auth/user identifiers must be verified against production first.
