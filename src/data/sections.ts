import { IDLE_FOCUS, type Focus } from '../brain/regions'
import type { TextBox } from '../deck/deckStore'
import { MEDICATION_SLIDES, SEED_BOXES as MEDICATION_SEED_BOXES } from './medications'

export type BackdropTheme = 'blue' | 'purple'

/**
 * What the background does around the cursor: the dots move out of its way ('part'), or rings
 * ripple out through the background colour and carry the dots with them ('ripple').
 */
export type CursorEffect = 'part' | 'ripple' | 'off'

/** For sections saved before the option existed. */
export const DEFAULT_CURSOR_EFFECT: CursorEffect = 'part'

export interface SlideSpec {
  id: string
  title: string
  focus: Focus
}

export interface Section {
  id: string
  title: string
  backdrop: BackdropTheme
  /** Left out, it is DEFAULT_CURSOR_EFFECT. */
  cursorEffect?: CursorEffect
  slides: SlideSpec[]
}

type SeedBox = Omit<TextBox, 'id' | 'slide'>

interface SeedSlide extends SlideSpec {
  boxes: SeedBox[]
}

interface SeedSection extends Omit<Section, 'slides'> {
  slides: SeedSlide[]
}

/** Left edge of the text column, clear of the brain. */
const LEFT = 0.05
/** Width of the text column, in stage units. */
const COLUMN = 39
/** Width of a half-column card for side-by-side template layouts. */
const HALF_COL = 18.8
const RIGHT_COL_X = LEFT + 0.205
/** Where the source line sits. */
const FOOT = 0.915

const title = (text: string): SeedBox => ({
  style: 'title',
  color: 'white',
  look: 'clear',
  text,
  x: LEFT,
  y: 0.05,
  width: COLUMN + 5,
})

const heading = (text: string, y: number): SeedBox => ({
  style: 'heading',
  color: 'white',
  look: 'clear',
  text,
  x: LEFT,
  y,
  width: COLUMN + 5,
})

const card = (text: string, y: number, x = LEFT + 0.008, width = COLUMN): SeedBox => ({
  style: 'body',
  color: 'white',
  look: 'frosted',
  text,
  x,
  y,
  width,
})

const source = (text: string, y = FOOT): SeedBox => ({
  style: 'small',
  color: 'grey',
  look: 'clear',
  text,
  x: LEFT,
  y,
  width: COLUMN + 5,
})

/** Starter template boxes for a newly added slide or section. */
export function makeTemplateSlideBoxes(slideTitle: string, subtitle = 'Section heading'): SeedBox[] {
  return [
    title(slideTitle),
    heading(subtitle, 0.18),
    card(
      'Key Point 1\n' +
        '• Double-click to enter your findings, notes, or clinical points\n' +
        '• Drag handles to resize or add more text boxes from the toolbar',
      0.27,
    ),
    card(
      'Key Point 2\n' +
        '• Add supporting details, nursing considerations, or examples\n' +
        '• Delete or rearrange boxes as needed',
      0.54,
    ),
    source('Source: Add APA citation(s) here'),
  ]
}

const TEMPLATE_SECTIONS: SeedSection[] = [
  {
    id: 'sec-1',
    title: 'Outline of Presentation',
    backdrop: 'blue',
    slides: [
      {
        id: '1-1',
        title: 'Outline of Presentation',
        focus: IDLE_FOCUS,
        boxes: [
          title('Anxiety Disorders'),
          heading('Outline of Presentation', 0.18),
          card(
            '1. Outline of Presentation\n' +
              '2. History\n' +
              '3. Epidemiology\n' +
              '4. Signs & Symptoms\n' +
              '5. DSM-5',
            0.275,
            LEFT + 0.008,
            HALF_COL,
          ),
          card(
            '6. Predisposing factors\n' +
              '7. Comorbidity\n' +
              '8. Medications\n' +
              '9. Milieu Management',
            0.275,
            RIGHT_COL_X,
            HALF_COL,
          ),
          card(
            'Team Members & Course Details\n' +
              '• Double-click to add presenter names and section assignments',
            0.61,
          ),
          source('Mental Health Nursing Presentation'),
        ],
      },
    ],
  },
  {
    id: 'sec-2',
    title: 'History',
    backdrop: 'blue',
    slides: [
      {
        id: '2-1',
        title: 'Historical Perspectives',
        focus: IDLE_FOCUS,
        boxes: [
          title('History'),
          heading('Early concepts & historical timeline', 0.18),
          card(
            'Early Perspectives\n' +
              '• Add ancient and early medical descriptions of fear and melancholia\n' +
              '• Key historical milestones and cultural perspectives',
            0.27,
          ),
          card(
            '19th–20th Century Shifts\n' +
              '• Concept of "neurasthenia" and "neurosis"\n' +
              '• Early psychological and psychoanalytic frameworks',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '2-2',
        title: 'Evolution of Diagnosis & Care',
        focus: { regions: ['amygdala', 'hippocampus'], circuits: [] },
        boxes: [
          title('History'),
          heading('From neurosis to modern neuroscience', 0.18),
          card(
            'Evolution Across Diagnostic Manuals\n' +
              '• Separation of panic, generalized anxiety, and phobic disorders\n' +
              '• Recognition of distinct neurobiological circuits',
            0.27,
          ),
          card(
            'Shifts in Treatment & Nursing Care\n' +
              '• Transition from institutional care to community-based mental health\n' +
              '• Emergence of evidence-based psychotherapy and pharmacotherapy',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
  {
    id: 'sec-3',
    title: 'Epidemiology',
    backdrop: 'blue',
    slides: [
      {
        id: '3-1',
        title: 'Prevalence & Demographics',
        focus: IDLE_FOCUS,
        boxes: [
          title('Epidemiology'),
          heading('Prevalence & population patterns', 0.18),
          card(
            'Prevalence Rates\n' +
              '• 12-month prevalence: [add %]\n' +
              '• Lifetime prevalence: [add %]\n' +
              '• Median age of onset: [add age]',
            0.27,
            LEFT + 0.008,
            HALF_COL,
          ),
          card(
            'Demographics\n' +
              '• Sex / gender ratio: [add data]\n' +
              '• Age distribution: [add data]\n' +
              '• High-risk populations: [add data]',
            0.27,
            RIGHT_COL_X,
            HALF_COL,
          ),
          card(
            'Epidemiological Summary\n' +
              '• Anxiety disorders are among the most common psychiatric conditions worldwide\n' +
              '• Add key comparison across disorder subtypes (GAD, Panic, Phobias)',
            0.58,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '3-2',
        title: 'Burden & Care Utilization',
        focus: IDLE_FOCUS,
        boxes: [
          title('Epidemiology'),
          heading('Global burden & treatment gap', 0.18),
          card(
            'Public Health & Functional Impact\n' +
              '• Leading contributor to disability-adjusted life years (DALYs)\n' +
              '• Impact on quality of life, work productivity, and primary care visits',
            0.27,
          ),
          card(
            'Barriers & Treatment Utilization\n' +
              '• Percentage of individuals receiving adequate treatment: [add %]\n' +
              '• Average delay from symptom onset to clinical care: [add years]',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
  {
    id: 'sec-4',
    title: 'Signs & Symptoms',
    backdrop: 'blue',
    slides: [
      {
        id: '4-1',
        title: 'Physical & Autonomic Signs',
        focus: { regions: ['amygdala', 'insula'], circuits: [] },
        boxes: [
          title('Signs & Symptoms'),
          heading('Physical & autonomic manifestations', 0.18),
          card(
            'Mild to Moderate Somatic Signs\n' +
              '• Vital signs: elevated HR, BP, and respiratory rate\n' +
              '• Muscle tension, restlessness, fatigue, GI discomfort, diaphoresis',
            0.27,
          ),
          card(
            'Severe to Panic-Level Signs\n' +
              '• Palpitations, chest pain, dyspnea, choking sensation, dizziness\n' +
              '• Paresthesias, trembling, chills or hot flashes, dilated pupils',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '4-2',
        title: 'Cognitive, Affective & Behavioral',
        focus: { regions: [], circuits: ['cstc'] },
        boxes: [
          title('Signs & Symptoms'),
          heading('Cognitive, emotional & behavioral signs', 0.18),
          card(
            'COGNITIVE\n' +
              '• Narrowed perceptual field, difficulty concentrating, worry, fear of losing control',
            0.265,
          ),
          card(
            'AFFECTIVE\n' +
              '• Apprehension, dread, irritability, helplessness, feeling overwhelmed',
            0.465,
          ),
          card(
            'BEHAVIORAL\n' +
              '• Avoidance, pacing, hypervigilance, restlessness, sleep disturbance',
            0.665,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
  {
    id: 'sec-5',
    title: 'DSM-5',
    backdrop: 'blue',
    slides: [
      {
        id: '5-1',
        title: 'DSM-5 Classification',
        focus: IDLE_FOCUS,
        boxes: [
          title('DSM-5'),
          heading('Anxiety disorder classifications', 0.18),
          card(
            'Core Anxiety Disorders\n' +
              '• Generalized Anxiety Disorder (GAD)\n' +
              '• Panic Disorder\n' +
              '• Agoraphobia',
            0.27,
            LEFT + 0.008,
            HALF_COL,
          ),
          card(
            'Phobic & Developmental\n' +
              '• Social Anxiety Disorder\n' +
              '• Specific Phobia\n' +
              '• Separation Anxiety / Selective Mutism',
            0.27,
            RIGHT_COL_X,
            HALF_COL,
          ),
          card(
            'Shared DSM-5 Core Features\n' +
              '• Excessive fear (response to real/perceived threat) and anxiety (anticipation of future threat)\n' +
              '• Causes clinically significant distress or functional impairment',
            0.58,
          ),
          source('Source: American Psychiatric Association (DSM-5-TR)'),
        ],
      },
      {
        id: '5-2',
        title: 'Diagnostic Criteria & Rule-Outs',
        focus: IDLE_FOCUS,
        boxes: [
          title('DSM-5'),
          heading('Diagnostic criteria & exclusions', 0.18),
          card(
            'Symptom & Duration Thresholds\n' +
              '• Duration requirement (e.g., ≥ 6 months for GAD, ≥ 1 month for Panic Disorder)\n' +
              '• Specific symptom count required for diagnosis: [add details]',
            0.27,
          ),
          card(
            'Medical & Substance Exclusions\n' +
              '• Not attributable to physiological effects of a substance or medication\n' +
              '• Not better explained by another medical condition (e.g., hyperthyroidism) or mental disorder',
            0.53,
          ),
          source('Source: American Psychiatric Association (DSM-5-TR)'),
        ],
      },
    ],
  },
  {
    id: 'sec-6',
    title: 'Predisposing factors',
    backdrop: 'blue',
    slides: [
      {
        id: '6-1',
        title: 'Biological & Genetic Factors',
        focus: { regions: ['amygdala', 'hippocampus', 'acc'], circuits: [] },
        boxes: [
          title('Predisposing Factors'),
          heading('Genetic & neurobiological vulnerability', 0.18),
          card(
            'Genetics & Temperament\n' +
              '• Family history and heritability risk in first-degree relatives\n' +
              '• Behavioral inhibition and heightened threat sensitivity',
            0.27,
          ),
          card(
            'Neurobiology & Neurochemistry\n' +
              '• Dysregulation of GABA, serotonin (5-HT), and norepinephrine pathways\n' +
              '• HPA-axis hyperactivity and limbic circuit sensitization',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '6-2',
        title: 'Psychological & Environmental Factors',
        focus: IDLE_FOCUS,
        boxes: [
          title('Predisposing Factors'),
          heading('Psychosocial & environmental influences', 0.18),
          card(
            'Early Life & Developmental Factors\n' +
              '• Adverse childhood experiences (ACEs), trauma, or loss\n' +
              '• Attachment patterns, parental modeling, and conditioning',
            0.27,
          ),
          card(
            'Environmental & Cognitive Stressors\n' +
              '• Chronic stress, major life transitions, and social determinants of health\n' +
              '• Cognitive distortions, intolerance of uncertainty, and avoidance coping',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
  {
    id: 'sec-7',
    title: 'Comorbidity',
    backdrop: 'blue',
    slides: [
      {
        id: '7-1',
        title: 'Psychiatric Comorbidities',
        focus: { regions: ['dlpfc', 'acc', 'amygdala'], circuits: [] },
        boxes: [
          title('Comorbidity'),
          heading('Co-occurring psychiatric disorders', 0.18),
          card(
            'Mood & Related Disorders\n' +
              '• High co-occurrence with Major Depressive Disorder (MDD) and other anxiety disorders\n' +
              '• Overlap with PTSD, OCD, and bipolar spectrum disorders',
            0.27,
          ),
          card(
            'Substance Use & Clinical Risk\n' +
              '• Increased risk of alcohol or sedative misuse (self-medication)\n' +
              '• Compounded symptom severity and elevated suicide risk',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '7-2',
        title: 'Medical Comorbidities & Impact',
        focus: { regions: ['insula'], circuits: [] },
        boxes: [
          title('Comorbidity'),
          heading('Medical overlap & nursing assessment', 0.18),
          card(
            'Co-occurring Medical Conditions\n' +
              '• Cardiovascular, respiratory (asthma/COPD), GI (IBS), and chronic pain syndromes\n' +
              '• Bidirectional worsening of physical and psychiatric outcomes',
            0.27,
          ),
          card(
            'Diagnostic & Care Coordination\n' +
              '• Screen routinely for depression, substance use, and medical mimics\n' +
              '• Integrate medical and psychiatric treatment plans',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
  {
    id: 'sec-8',
    title: 'Medications',
    backdrop: 'blue',
    slides: MEDICATION_SLIDES,
  },
  {
    id: 'sec-9',
    title: 'Milieu Management',
    backdrop: 'blue',
    slides: [
      {
        id: '9-1',
        title: 'Therapeutic Environment & Safety',
        focus: IDLE_FOCUS,
        boxes: [
          title('Milieu Management'),
          heading('Structuring a calm, safe environment', 0.18),
          card(
            'Environmental Modifications\n' +
              '• Minimize sensory overload: quiet space, soft lighting, reduced crowding\n' +
              '• Maintain physical safety and remove potential hazards',
            0.27,
          ),
          card(
            'Structure, Routine & Grounding\n' +
              '• Provide predictable schedules and clear, calm expectations\n' +
              '• Offer grounding techniques and gross-motor outlets to release tension',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
      {
        id: '9-2',
        title: 'Nursing Interventions by Severity',
        focus: IDLE_FOCUS,
        boxes: [
          title('Milieu Management'),
          heading('Communication & de-escalation', 0.18),
          card(
            'Mild to Moderate Anxiety\n' +
              '• Use calm presence, active listening, and open-ended questions\n' +
              '• Help recognize triggers and practice relaxation or breathing exercises',
            0.27,
          ),
          card(
            'Severe to Panic-Level Anxiety\n' +
              '• Stay with the client — never leave a client in panic alone\n' +
              '• Use short, simple, firm, directive statements\n' +
              '• Defer teaching and cognitive problem-solving until acute anxiety subsides',
            0.53,
          ),
          source('Source: Add APA citation(s) here'),
        ],
      },
    ],
  },
]

export const SEED_SECTIONS: Section[] = TEMPLATE_SECTIONS.map(({ slides, ...section }) => ({
  ...section,
  slides: slides.map(({ id, title: slideTitle, focus }) => ({ id, title: slideTitle, focus })),
}))

export const NON_MEDICATION_SEED_BOXES: TextBox[] = TEMPLATE_SECTIONS.filter((s) => s.id !== 'sec-8').flatMap(
  (section) =>
    section.slides.flatMap((slide) =>
      slide.boxes.map((box, index) => ({
        ...box,
        id: `seed-${slide.id}-${index}`,
        slide: slide.id,
      })),
    ),
)

export const ALL_SEED_BOXES: TextBox[] = [...NON_MEDICATION_SEED_BOXES, ...MEDICATION_SEED_BOXES]
