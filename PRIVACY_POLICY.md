# ChatWave Privacy Notice — Publication Draft

**Status:** Draft for product and local counsel review. This document is not ready to publish until every bracketed field is completed and the actual service, vendors, retention schedule, age-assurance process, and contact routes match it.

**Controller/operator:** `[Full legal entity name]`, `[registered address]`  
**Privacy contact:** `[privacy email]`  
**Data protection officer, if required:** `[name and contact]`  
**Effective date:** `[date of launch]`  
**Countries covered:** `[launch countries and regional supplements]`

## 1. The current prototype

This project includes a browser preview and an optional local development API. Opening `index.html` directly or adding `?preview=1` uses the preview. If an operator starts the documented local server, it can create development accounts, save profile details, text posts and text messages in that operator's PostgreSQL database, and upload supported files to a private local object-storage quarantine. In local development, verification codes are printed to the server terminal; no SMS provider or external cloud account is configured by default. Use test data only. This is not a public production service, and the API code is not a claim that every planned control is complete.

## 2. Information the service is designed to use

Depending on the features a person chooses, the planned service may process:

- **Account and verification:** phone number, verification attempts and results, password hash, account identifier, and session/security events. The service should never store a readable password or log one-time codes.
- **Profile and age:** display name, unique username, date of birth or age band, gender if the user chooses to provide it, profile photo, biography, country/region, language, and age-protection status. Collect only fields that have a documented purpose.
- **Content and communications:** posts, comments, reactions, stories, channel/video uploads, private messages, group/channel membership, shared files, and related metadata such as timestamps and audience choices.
- **Contacts and social activity:** friend requests, accepted connections, follows, blocks, reports, saved items, and content preferences.
- **Safety and technical data:** device/browser details, IP address, approximate region, sign-in logs, abuse signals, moderation decisions, and report attachments, only as needed for account security, service operation, and safety.
- **Support:** a user’s message, selected report category, attachments, and information needed to investigate and respond.

ChatWave should not request precise location, address-book access, government identification, or sensitive personal information unless a specific feature and lawful basis are approved first.

## 3. Purposes and lawful grounds

The operator must select and document a lawful ground for each processing purpose in each launch region. Proposed purposes include creating and securing accounts; delivering messages and content; applying user-selected privacy controls; operating channels and recommendations; preventing spam, fraud, abuse, and security incidents; handling reports and legal requests; and meeting accounting or other legal duties.

For users covered by the GDPR, the operator must identify the applicable basis (for example, contract, legal obligation, consent, or a documented legitimate-interest assessment) before processing and explain it in the final notice. Optional personalization, marketing, or non-essential tracking must not be bundled with account consent where separate consent is required. See the [European Commission’s explanation of lawful grounds](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en).

## 4. Audience and visibility

Content marked public can be seen, copied, indexed, or redistributed by people outside a user’s friend list. Private-account settings should default to high privacy for minors and should be enforced by the server for every read, search, share, and download. A privacy toggle in the interface alone does not protect content. A person should be able to review the audience before posting and change or remove content later, subject to limited legal, safety, and backup-retention exceptions.

Private messages are not end-to-end encrypted. In the optional local development server, text messages are stored in the configured PostgreSQL database. The final service must state its actual encryption model, who can access message content, how backups work, and what happens when a user reports a message. Do not describe messages as end-to-end encrypted unless the deployed protocol and key handling actually provide that protection.

## 5. Children and age-specific protections

ChatWave is intended to be used by people in multiple age groups, so age assurance and child privacy protections must be designed before launch. A date-of-birth screen is only a starting point. The operator must determine each country’s age rules, apply an appropriate age-assurance method, obtain verifiable parental consent where required before collecting a child’s personal information, provide parents the rights and notices required by law, and maintain a tested guardian-support process.

For the United States, the FTC’s COPPA Rule applies to covered services directed to children under 13 and to general-audience services with actual knowledge they collect personal information from a child under 13. The FTC published amendments on April 22, 2025, including separate parental consent for certain disclosures to third parties and limits on retaining children’s data. The final flow must follow the current rule, not rely on a checkbox alone. See the [FTC business guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) and [2025 final-rule notice](https://www.ftc.gov/legal-library/browse/federal-register-notices/16-cfr-part-312-coppa-final-rule-amendments).

For users under 18 in the United Kingdom, assess the ICO Children’s Code where the service is likely to be accessed by children. Its standards address children’s best interests, an age-appropriate design assessment, high-privacy defaults, data minimisation, sharing, geolocation, profiling, parental controls, and accessible rights/reporting tools. See the [ICO Children’s Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/).

For the EU, the age at which a child may consent to information-society services on the basis of consent varies by Member State between 13 and 16. Other legal bases and local child-protection rules may also apply. Configure the flow country by country; do not infer that one global age checkbox settles eligibility.

The prototype routes users under 18 to a protective preview and does not collect their phone number in that route. This is a conservative prototype gate, not a statement of the legal age in every country and not a real parental-consent process.

## 6. Sharing and service providers

The operator must publish the actual categories or names of processors and recipients, their purposes, locations, and contractual safeguards. Expected categories may include SMS verification, cloud hosting and storage, video delivery/transcoding, abuse prevention, customer support, and legal/professional advisers. Do not enable advertising, sale/share of personal information, or cross-service tracking without first documenting the data flows, legal basis, required consent/opt-outs, and child-specific restrictions.

## 7. International transfers

ChatWave is intended for multiple countries. Before launch, identify where account data, media, backups, and support records are stored and accessed. For restricted transfers, disclose the destination and the safeguard or transfer mechanism used, complete required assessments, and offer supplementary measures where necessary. `[Insert transfer mechanism and countries.]`

## 8. Retention and deletion

Keep personal information only as long as needed for a stated purpose, then securely delete or de-identify it. Before publication, fill in the retention schedule for account data, verification records, posts, private messages, reports, moderation evidence, security logs, and backups. Do not promise a deletion deadline until deletion from replicas, processors, and backup cycles has been implemented and verified. Legal holds and narrowly defined safety/fraud records may require limited retention; explain the basis and period.

Users should be able to deactivate an account, request deletion, correct profile information, and request an export. Deletion and export must include relevant media and processor instructions, with clear disclosure of any data that must be retained by law. California businesses subject to the CCPA have specified rights and request-handling duties; see the [California Privacy Protection Agency FAQ](https://cppa.ca.gov/faq) and the [CCPA statute effective January 1, 2026](https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf).

## 9. Security

The local API code includes secure password hashing, rate-limited verification routes, session cookies, database row-level policies for core records, private object buckets, and short-lived download links for approved assets. It does not yet include a malware/content scanning worker, production SMS delivery, backup and restore operations, full moderation, or a completed production key-management setup. Production safeguards must be independently configured and reviewed before launch. No security statement guarantees that an incident can never occur.

## 10. Cookies and local storage

The preview uses browser local storage for the weekly story quota and temporary object URLs for selected files. The local server uses a same-site, HttpOnly session cookie. A production service must inventory cookies, local storage, SDKs, analytics, and similar technologies, disclose each purpose and duration, and obtain consent where required. `[Insert production cookie table and consent mechanism.]`

## 11. Rights and choices

Depending on location, users may have rights to access, correct, delete, restrict, object to, or receive a portable copy of their personal information; withdraw consent; opt out of sale/sharing or targeted advertising; limit certain uses of sensitive information; appeal a denial; and complain to a data-protection authority. The final notice must explain how to make a request, how identity is verified proportionately, response times, and any appeal route. GDPR rights are summarized by the [European Commission](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en).

## 12. Changes and contact

We will update this notice when processing changes, show the effective date, and provide any notice or renewed consent required by law. Contact `[privacy email]` or `[postal address]`. EU/UK representative and supervisory-authority details: `[complete if required]`.

## Publication checklist — remove this section only after completion

- Confirm the legal operator, address, privacy contact, DPO/representative, and launch countries.
- Map every data field, SDK, processor, transfer, purpose, lawful basis, retention period, and deletion path.
- Complete a DPIA and child-safety/age-assurance review; implement a verifiable guardian flow where required.
- Decide whether messages are end-to-end encrypted and align reports, backups, support, and key recovery with that decision.
- Publish separate regional notices and rights routes where required; have qualified counsel review them.
