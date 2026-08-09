---
id: design-mindset-and-rules
title: "Design Mindsets and Rules: A Unified Framework for Game, Web, and Mobile App Design"
summary: Core protocol for design mindset and rules.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Design Mindsets and Rules: A Unified Framework for Game, Web, and Mobile App Design

## 1. The Trinity of Modern Design Mindsets

Modern digital design requires a synthesis of psychological and structural approaches tailored to the medium. As a Senior Design Systems Architect, I interpret these mediums through the lenses of the MDA and AARRR frameworks to transform interfaces into sophisticated "habit engines."

### 1.1 The Game Designer Mindset: The MDA Framework
The **MDA Framework** (Mechanics, Dynamics, Aesthetics) formalizes the bridge between system rules and human experience.
*   **Mechanics:** The formal rules and components (XP requirements, reward tracks, gacha probability).
*   **Dynamics:** The emergent behaviors occurring during play (login frequency, session length). These dynamics directly serve the **Retention** stage of the **AARRR Framework**, converting habitual engagement into **Lifetime Value (LTV)**.
*   **Aesthetics:** The emotional outcomes (sense of progression, urgency, or pressure).

**Design Constraint:** Architects must prioritize intrinsic motivation while minimizing "Dark Design Patterns" that erode autonomy. This includes **Grinding** (rewarding time over skill) and **Playing by Appointment** (imposing external schedules via in-game timers).

### 1.2 The Web Designer Mindset: Information Architecture
Web design centers on aligning system behavior with established mental models. **Jakob’s Law** dictates that users spend most of their time on *other* sites; therefore, navigating your site should require zero learning curve. Alignment with external standards reduces the cognitive load required to move through information hierarchies.

### 1.3 The Mobile App Designer Mindset: Utility and Ergonomics
Mobile design is governed by the physics of touch. We apply **Fitts's Law** to determine target accessibility. The **Index of Difficulty (ID)** is the mathematical relationship between target distance ($D$) and target width ($W$): $ID = \log_2(2D/W)$. To optimize ergonomics, interactive elements must minimize this index by being large enough for thumb-zone interaction and positioned to reduce travel distance.

---

## 2. Core Laws of User Experience

### Jakob’s Law
*   **Rule:** Users transfer expectations from familiar products to yours.
*   **HCI Insight:** Leverage existing mental models to avoid "mental model discordance."
*   **Case Study:** The **2017 YouTube Redesign** mitigated discordance by allowing desktop users to preview the Material Design UI and revert to the old version until they were ready to commit.

### Fitts’s Law
*   **Rule:** The time to acquire a target is a function of distance and size.
*   **Takeaway:** Calculate the **Index of Difficulty ($ID$)**. Important actions should be placed in the "Thumb Zone" (bottom-third of mobile screens) and sized generously to reduce movement time.

### Hick’s Law
*   **Rule:** Decision time increases logarithmically with the number and complexity of choices.
*   **Takeaway:** Reduce cognitive load by "chunking" choices. Highlighting a "Recommended" option guides users through choice overload.

### Miller’s Law
*   **Rule:** The average human can only hold 7 (±2) items in their **working memory**.
*   **Takeaway:** Working memory is the biological bottleneck of UX. Use chunking to organize information into meaningful groups (e.g., 555-0123 instead of 5550123) to prevent cognitive overflow.

### Aesthetic-Usability Effect
*   **Rule:** Users perceive aesthetically pleasing designs as more functional.
*   **Takeaway:** Beauty builds trust. While high-quality visual polish masks minor usability flaws, it is most effective when it catalyzes creative thinking and reduces the stress associated with complex tasks.

---

## 3. Gestalt Principles and Visual Hierarchy

We apply the **Law of Prägnanz** to explain how the brain simplifies complex imagery to reduce **cognitive effort**.

*   **Law of Proximity:** Elements positioned close together are perceived as a related group. Specifically, labels must be placed directly adjacent to their *related* input fields.
*   **Law of Similarity:** Elements sharing visual traits (size, color, shape) are perceived as having the same function. Use consistent styling for all interactive elements like buttons or hyperlinks.
*   **Law of Common Region:** Elements within a boundary or sharing a background color are perceived as belonging together. Use borders to signify functional containers.
*   **Law of Continuity and Closure:** The brain prefers the simplest path and will "close" gaps in incomplete shapes. Use this to simplify UI icons, reducing the effort required for the brain to process the interface.

---

## 4. Nielsen’s 10 Usability Heuristics

| Heuristic Name | 1-Sentence Summary | Actionable Design Rule |
| :--- | :--- | :--- |
| **1. Visibility of System Status** | Keep users informed through timely feedback. | Use progress bars; never take a consequential action without immediate feedback. |
| **2. Match: System & Real World** | Use language and concepts familiar to the user. | Utilize **Natural Mapping** (e.g., stovetop-style layout for controls). |
| **3. User Control & Freedom** | Provide "emergency exits" for accidental actions. | Always include **Cancel** buttons and support Undo/Redo. |
| **4. Consistency & Standards** | Follow platform and industry conventions. | Maintain internal consistency and Jakob's Law (external standards). |
| **5. Error Prevention** | Eliminate error-prone conditions or confirm actions. | Distinguish between **Slips** (inattention) and **Mistakes** (mental model mismatch). |
| **6. Recognition over Recall** | Make elements and options visible to reduce memory load. | Offer help in-context so users don't have to memorize instructions. |
| **7. Flexibility & Efficiency** | Provide accelerators for expert users. | Implement keyboard shortcuts and customizable touch gestures. |
| **8. Aesthetic & Minimalist** | Remove irrelevant info that competes with relevant info. | Prioritize content that supports only the user's primary goals. |
| **9. Error Recovery** | Use plain language to suggest solutions. | Messages must **constructively suggest a solution** and provide a direct "fix" link. |
| **10. Help & Documentation** | Provide searchable, task-focused documentation. | List concrete, concise steps to be carried out at the moment of need. |

---

## 5. Universal Accessibility and Contrast (WCAG 2.2)

Inclusive design is a technical specification, not a suggestion.

*   **Contrast Standards:** Body text must maintain a **4.5:1** ratio; large text (18pt+) must maintain **3:1**.
*   **Navigational Readiness:** 
    *   **Keyboard:** Visible focus states (focus rings) are mandatory for all interactive elements.
    *   **Screen Readers:** Use Semantic HTML and ARIA landmarks to ensure interpretability.
*   **Error Treatment:** Following Heuristic #9, error messages must be visually distinct (bold/red) and linguistically actionable. An error message without a "fix" link or constructive suggestion is a failure of accessibility.

---

## 6. Premium Implementation Checklist: Rules for AI & Software Dev

### Structural Integrity (MDA & Monetization)
- **Map Mechanics to Aesthetics:** Define the intended emotional outcome (Dynamics) for every rule.
- **Forbid Autonomy Erosion:** Do not use "Playing by Appointment" or "Grinding" to artificially inflate retention.
- **Implement the Pity System:** For randomized rewards, guarantee high-rarity items after $X$ attempts to reduce "perceived financial risk."

### The "Premium" Feel (HCI Thresholds)
- **Doherty Threshold:** System responses must occur within **400ms**. If a task exceeds this, a **progress bar** is mandatory.
- **Fitts’s Optimization:** Primary CTAs must be in the ergonomic "Thumb Zone" to minimize the Index of Difficulty.
- **Constructive Errors:** All error states must provide a solution-oriented "fix" path.
- **Visual Verification (Reference-Grounded):** Follow `visual-grounding.md`. Capture/render visual evidence when appearance is part of acceptance, then compare it to the inspected project design system/reference plus deterministic layout/accessibility checks. Do not claim aesthetics from code structure alone or require screenshots for unrelated trivial UI-file edits.

### Constraint Rule
- All instructions must be in plain text. Prohibit non-textual elements like flowcharts or mermaid diagrams.

---

## 7. Summary of Engagement Metrics

We utilize the **AARRR Framework** (Acquisition, Activation, Retention, Revenue, Referral) to analyze the "Economy of Engagement."

### The Engagement/Satisfaction Gap
Retention is a prerequisite for revenue conversion (LTV), but it is often decoupled from satisfaction. Survey data shows that **27 of 38 respondents** accepted the commercial logic of retention design, yet many reported a "negative experience" while staying "hooked." 

**Critical HCI Risk:** Designers must avoid "autonomy erosion." As cited in current research: *"A design shift that tightened time constraints... turned exploration into a chore."* When systems prioritize extrinsic motivation (FOMO) over intrinsic interest, they may sustain LTV in the short term while causing long-term brand burnout.