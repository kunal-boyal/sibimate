# Decisions

Decisions on the open questions from the architecture, made on 20 November 2026. Where this file and the architecture differ, this file is newer.

## Providers and platform

| Question | Decision | What it needs before launch |
| --- | --- | --- |
| SMS for sign-in codes | **MSG91** | Register Sibimate as a sender and the OTP template on the DLT portal (TRAI rules; takes days), then set `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY` and `MSG91_OTP_TEMPLATE_ID` in the API's settings. The code is ready. |
| AI model and speech-to-text | **OpenAI** for both | An OpenAI API key, `TASK_INTERPRETER=openai`. Test Hindi accuracy on real recordings. |
| Hosting | **AWS, Mumbai region (ap-south-1)** | An AWS account; then staging. Helpers' documents go to a private S3 bucket (`STORAGE_DRIVER=s3`, `S3_DOCUMENTS_BUCKET`); the code is ready. |
| Payments | **Razorpay Route** | Confirm with Razorpay that individual helpers can be Linked Accounts, the KYC each needs, the fees, and how a payment made early is held until the completion code. Milestone 3 is built once confirmed. |
| Map tiles | **Ola Maps** | An Ola Maps key. The tracking map takes any raster tile address through `EXPO_PUBLIC_MAP_TILE_URL`; if Ola Maps offers only vector tiles for this use, the map moves to a vector map library. Check when signing up. |
| App id | **com.sibimate.app** | Nothing: already set for Android and iOS. |

## Rules

All four can be changed by the owner or finance role from the dashboard's Settings page. Each change takes effect at once and is recorded in the audit log with its old value.

| Rule | Starting value |
| --- | --- |
| Cancellation fee, paid to the helper when a customer cancels after the helper has set off | ₹30 |
| Cash dues limit: unpaid commission from cash jobs above which a helper sees only online-payment tasks | ₹500 |
| Dispute window after a job | 48 hours |
| Wait for the completion code before an admin is alerted | 30 minutes |

The values are stored now; charging the fee, enforcing the dues limit and the two time limits are built with payments (milestone 3) and disputes (milestone 4).

## Product

- **Skilled tag**: earned with an ITI certificate or a licence for the trade, or else with photos of past work and a reference that a verifier calls. Given only at the Specialised level.
- **Group jobs**: a task that needs several people is booked with one helper, who is paid for the whole job and brings the others. Helpers are told this before they accept.
- **Language of task details**: the customer's own language. Hindi is written in Devanagari.
- **Repository**: the code is pushed to the public repository github.com/kunal-boyal/sibimate, docs and designs included.
- **Planning documents**: not kept in the repository; the architecture records their decisions.

## Still open

- **Legal review**: helper and customer terms, GST and e-commerce operator duties, the aggregator contribution, DPDP duties from 13 May 2027, and telling users that recordings and task text are processed by OpenAI. Needs a lawyer.
- **Hindi copy**: every Hindi string in the app needs a native speaker's review before launch.
