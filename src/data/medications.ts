import type { Focus } from '../brain/regions'
import type { TextBox } from '../deck/deckStore'

/**
 * The Medications section: what each slide points the brain at, and the text it starts with.
 * Nursing content follows RM Ch. 11 and the Engage modules. Mechanism and brain targets come from
 * the sources on the reference slides. A slide only lights a region when a source supports it.
 */

type SeedBox = Omit<TextBox, 'id' | 'slide'>

export interface MedicationSlide {
  id: string
  title: string
  focus: Focus
  boxes: SeedBox[]
}

/** Left edge of the text column, clear of the brain. */
const LEFT = 0.05
/** Width of the text column, in stage units. */
const COLUMN = 39
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

const card = (text: string, y: number): SeedBox => ({
  style: 'body',
  color: 'white',
  look: 'frosted',
  text,
  x: LEFT + 0.008,
  y,
  width: COLUMN,
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

const references = (text: string): SeedBox => ({
  style: 'small',
  color: 'white',
  look: 'frosted',
  text,
  x: LEFT + 0.008,
  y: 0.18,
  width: COLUMN + 4,
})

const IDLE: Focus = { regions: [], circuits: [] }

export const MEDICATION_SLIDES: MedicationSlide[] = [
  {
    id: '1',
    title: 'Overview',
    focus: IDLE,
    boxes: [
      title('Medications for Anxiety Disorders'),
      heading('Two symptoms, two circuits', 0.265),
      card(
        'Fear: sudden alarm, panic and avoidance. Centered on the amygdala.\n\n' +
          'Worry: ongoing dread about what might happen. Proposed to run through the CSTC loop.\n\n' +
          'Most anxiety medications are thought to calm these circuits. They treat symptoms, not the cause, and CBT is also a first-line treatment.',
        0.355,
      ),
      source('ATI, 2026; Stahl, 2021; Szuhany & Simon, 2022'),
    ],
  },
  {
    id: '2',
    title: 'Fear: the amygdala',
    focus: { regions: ['amygdala'], circuits: [] },
    boxes: [
      title('Fear: the amygdala'),
      heading('The brain’s threat detector', 0.18),
      card(
        '• Pulls together danger signals from the senses and from fearful memories\n' +
          '• The prefrontal cortex can help suppress the response\n' +
          '• More active than usual in PTSD, social anxiety disorder and specific phobia',
        0.27,
      ),
      source('Etkin & Wager, 2007; Stahl & Grady, 2010'),
    ],
  },
  {
    id: '3',
    title: 'Worry: the CSTC loop',
    focus: { regions: [], circuits: ['cstc'] },
    boxes: [
      title('Worry: the CSTC loop'),
      heading('A proposed model, not settled', 0.18),
      card(
        '• Cortico-striato-thalamo-cortical: prefrontal cortex to the striatum, pallidum and thalamus, then back to the cortex\n' +
          '• Stahl links worry to this loop\n' +
          '• Imaging of worry itself points to the medial prefrontal and anterior cingulate cortex\n' +
          '• In GAD, that activity continued into rest after the worry task ended',
        0.27,
      ),
      source('Paulesu et al., 2010; Stahl, 2021'),
    ],
  },
  {
    id: '4',
    title: 'SSRIs and SNRIs',
    focus: { regions: ['amygdala'], circuits: ['cstc'] },
    boxes: [
      title('SSRIs and SNRIs'),
      heading('First line for anxiety disorders', 0.18),
      card(
        'SSRIs: paroxetine, sertraline, fluoxetine, escitalopram\n' +
          'SNRIs: venlafaxine, duloxetine\n\n' +
          '• Block reuptake of serotonin (SNRIs also norepinephrine), which reaches many anxiety networks\n' +
          '• Sertraline lowered amygdala reactivity in social anxiety\n' +
          '• Take daily. SSRIs can take 4 to 6 weeks, SNRIs 6 to 8\n' +
          '• Early: nausea, sweating, tremor. Later: sexual dysfunction, weight gain\n' +
          '• Watch for serotonin syndrome and suicidal thoughts. SNRIs: monitor BP\n' +
          '• Taper. Never stop abruptly',
        0.27,
      ),
      source('ATI, 2026; Phan et al., 2013; Stahl, 2021; Szuhany & Simon, 2022'),
    ],
  },
  {
    id: '5',
    title: 'Benzodiazepines',
    focus: { regions: ['amygdala', 'insula'], circuits: [] },
    boxes: [
      title('Benzodiazepines'),
      heading('Fast relief, for short-term use', 0.18),
      card(
        'Alprazolam, lorazepam, diazepam\n\n' +
          '• Boost GABA, the brain’s main calming signal\n' +
          '• Lorazepam lowered amygdala and insula activity in healthy volunteers\n' +
          '• Work quickly, but no longer first line on their own\n' +
          '• Watch for sedation, falls, amnesia and paradoxical rage\n' +
          '• Boxed warning: misuse, dependence, withdrawal. Taper slowly\n' +
          '• No alcohol. Flumazenil reverses toxicity',
        0.27,
      ),
      source('ATI, 2026; FDA, 2020; Garakani et al., 2020; Paulus et al., 2005'),
    ],
  },
  {
    id: '6',
    title: 'Buspirone',
    // The label calls its mechanism unknown, so no region is claimed.
    focus: IDLE,
    boxes: [
      title('Buspirone'),
      heading('A daily medication, never PRN', 0.18),
      card(
        '• For GAD and long-term anxiety, often added to an SSRI or SNRI\n' +
          '• Binds serotonin 5-HT1A receptors, but its exact mechanism is unknown, so no region is lit here\n' +
          '• First effect in about 1 week, full effect by about 4 weeks\n' +
          '• Same time each day, with meals\n' +
          '• Low dependence risk, little or no sedation\n' +
          '• Avoid grapefruit juice and St. John’s wort. No MAOI within 14 days',
        0.27,
      ),
      source('ATI, 2026; Bristol-Myers Squibb, 2010; Garakani et al., 2020'),
    ],
  },
  {
    id: '7',
    title: 'Gabapentin and pregabalin',
    focus: { regions: ['amygdala', 'insula'], circuits: [] },
    boxes: [
      title('Gabapentin and pregabalin'),
      heading('Off-label for anxiety in the U.S.', 0.265),
      card(
        '• Bind the α2δ subunit of calcium channels, so neurons release less neurotransmitter\n' +
          '• Pregabalin lowered amygdala and insula activity in healthy volunteers\n' +
          '• Moderate evidence overall. Strongest for pregabalin in GAD, where it is approved in the EU\n' +
          '• Watch for dizziness, sleepiness and suicidal thoughts\n' +
          '• Breathing problems: higher risk with opioids or other CNS depressants, lung disease, older age',
        0.355,
      ),
      source('Aupperle et al., 2011; FDA, 2019; Garakani et al., 2020; Hong et al., 2022; Viatris, 2025'),
    ],
  },
  {
    id: '8',
    title: 'Propranolol and hydroxyzine',
    // Neither has evidence tying it to these circuits.
    focus: IDLE,
    boxes: [
      title('Propranolol and hydroxyzine'),
      heading('Other options, with weaker evidence', 0.265),
      card(
        'Propranolol (beta blocker)\n' +
          '• Lowers elevated vital signs and anxiety symptoms\n' +
          '• Off-label, and evidence is too weak for routine use\n' +
          '• Check pulse and BP first. Contraindicated in asthma',
        0.355,
      ),
      card(
        'Hydroxyzine (antihistamine)\n' +
          '• The only antihistamine FDA-approved for anxiety\n' +
          '• Beat placebo in GAD, but not a reliable first-line choice\n' +
          '• Watch for drowsiness and QT prolongation',
        0.555,
      ),
      source(
        'Akrimax, 2010; Archer et al., 2025; ATI, 2026; Garakani et al., 2020; Guaiana et al., 2010; Pfizer, 2016; Steenen et al., 2016',
        0.895,
      ),
    ],
  },
  {
    id: '9',
    title: 'Nursing takeaways',
    focus: IDLE,
    boxes: [
      title('Nursing takeaways'),
      card('ASSESS\nSuicide risk, substance use, fall risk and pregnancy plans', 0.185),
      card(
        'TEACH\nWhich drugs work fast and which take weeks. Take slow-onset drugs daily. Avoid alcohol. Never stop abruptly.',
        0.345,
      ),
      card(
        'WATCH FOR\nSerotonin syndrome: agitation, fever, sweating, hyperreflexia. Hold the drug and call the provider. Also CNS and respiratory depression.',
        0.54,
      ),
      card('EVALUATE\nLess anxiety, better mood, normal sleep, coping, ADLs', 0.735),
      source('ATI, 2026'),
    ],
  },
  {
    id: '10',
    title: 'References',
    focus: IDLE,
    boxes: [
      title('References'),
      references(
        [
          'Akrimax Pharmaceuticals. (2010). Inderal (propranolol hydrochloride) tablets [Package insert]. https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/016418s080,016762s017,017683s008lbl.pdf',
          'Archer, C., Wiles, N., Kessler, D., Turner, K., & Caldwell, D. M. (2025). Beta-blockers for the treatment of anxiety disorders: A systematic review and meta-analysis. Journal of Affective Disorders, 368, 90–99. https://doi.org/10.1016/j.jad.2024.09.068',
          'Assessment Technologies Institute. (2026). RN mental health nursing review module (Ed. 13.0).',
          'Aupperle, R. L., Ravindran, L., Tankersley, D., Flagan, T., Stein, N. R., Simmons, A. N., Stein, M. B., & Paulus, M. P. (2011). Pregabalin influences insula and amygdala activation during anticipation of emotional images. Neuropsychopharmacology, 36(7), 1466–1477. https://doi.org/10.1038/npp.2011.32',
          'Bristol-Myers Squibb. (2010). BuSpar (buspirone HCl, USP) [Package insert]. https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/018731s051lbl.pdf',
          'Etkin, A., & Wager, T. D. (2007). Functional neuroimaging of anxiety: A meta-analysis of emotional processing in PTSD, social anxiety disorder, and specific phobia. American Journal of Psychiatry, 164(10), 1476–1488. https://doi.org/10.1176/appi.ajp.2007.07030504',
          'Garakani, A., Murrough, J. W., Freire, R. C., Thom, R. P., Larkin, K., Buono, F. D., & Iosifescu, D. V. (2020). Pharmacotherapy of anxiety disorders: Current and emerging treatment options. Frontiers in Psychiatry, 11, Article 595584. https://doi.org/10.3389/fpsyt.2020.595584',
        ].join('\n\n'),
      ),
    ],
  },
  {
    id: '11',
    title: 'References (continued)',
    focus: IDLE,
    boxes: [
      title('References'),
      references(
        [
          'Guaiana, G., Barbui, C., & Cipriani, A. (2010). Hydroxyzine for generalised anxiety disorder. Cochrane Database of Systematic Reviews, 2010(12), Article CD006815. https://doi.org/10.1002/14651858.CD006815.pub2',
          'Hong, J. S. W., Atkinson, L. Z., Al-Juffali, N., Awad, A., Geddes, J. R., Tunbridge, E. M., Harrison, P. J., & Cipriani, A. (2022). Gabapentin and pregabalin in bipolar disorder, anxiety states, and insomnia: Systematic review, meta-analysis, and rationale. Molecular Psychiatry, 27(3), 1339–1349. https://doi.org/10.1038/s41380-021-01386-6',
          'Paulesu, E., Sambugaro, E., Torti, T., Danelli, L., Ferri, F., Scialfa, G., Sberna, M., Ruggiero, G. M., Bottini, G., & Sassaroli, S. (2010). Neural correlates of worry in generalized anxiety disorder and in normal controls: A functional MRI study. Psychological Medicine, 40(1), 117–124. https://doi.org/10.1017/S0033291709005649',
          'Paulus, M. P., Feinstein, J. S., Castillo, G., Simmons, A. N., & Stein, M. B. (2005). Dose-dependent decrease of activation in bilateral amygdala and insula by lorazepam during emotion processing. Archives of General Psychiatry, 62(3), 282–288. https://doi.org/10.1001/archpsyc.62.3.282',
          'Pfizer. (2016). Vistaril (hydroxyzine pamoate) [Package insert]. https://www.accessdata.fda.gov/drugsatfda_docs/label/2016/011459s051_011795s028lbl.pdf',
          'Phan, K. L., Coccaro, E. F., Angstadt, M., Kreger, K. J., Mayberg, H. S., Liberzon, I., & Stein, M. B. (2013). Corticolimbic brain reactivity to social signals of threat before and after sertraline treatment in generalized social phobia. Biological Psychiatry, 73(4), 329–336. https://doi.org/10.1016/j.biopsych.2012.10.003',
          'Stahl, S. M. (2021). Stahl’s essential psychopharmacology: Neuroscientific basis and practical applications (5th ed.). Cambridge University Press.',
        ].join('\n\n'),
      ),
    ],
  },
  {
    id: '12',
    title: 'References and credits',
    focus: IDLE,
    boxes: [
      title('References'),
      references(
        [
          'Stahl, S. M., & Grady, M. M. (2010). Stahl’s illustrated anxiety, stress, and PTSD. Cambridge University Press.',
          'Steenen, S. A., van Wijk, A. J., van der Heijden, G. J. M. G., van Westrhenen, R., de Lange, J., & de Jongh, A. (2016). Propranolol for the treatment of anxiety disorders: Systematic review and meta-analysis. Journal of Psychopharmacology, 30(2), 128–139. https://doi.org/10.1177/0269881115612236',
          'Szuhany, K. L., & Simon, N. M. (2022). Anxiety disorders: A review. JAMA, 328(24), 2431–2445. https://doi.org/10.1001/jama.2022.22744',
          'U.S. Food and Drug Administration. (2019, December 19). Neurontin, Gralise, Horizant (gabapentin) and Lyrica, Lyrica CR (pregabalin): Drug safety communication - Serious breathing problems. https://www.fda.gov/safety/medical-product-safety-information/neurontin-gralise-horizant-gabapentin-and-lyrica-lyrica-cr-pregabalin-drug-safety-communication',
          'U.S. Food and Drug Administration. (2020, September 23). FDA requiring boxed warning updated to improve safe use of benzodiazepine drug class. https://www.fda.gov/drugs/drug-safety-and-availability/fda-requiring-boxed-warning-updated-improve-safe-use-benzodiazepine-drug-class',
          'Viatris. (2025). Neurontin (gabapentin) [Package insert]. https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/020235s079,020882s060,021129s059lbl.pdf',
        ].join('\n\n'),
      ),
      source('3D brain derived from Z-Anatomy and BodyParts3D, CC BY-SA 4.0. For education only. Not medical advice.', 0.895),
    ],
  },
]

/** Every slide's starting text, as boxes the store can hold. Fixed ids keep each one identifiable. */
export const SEED_BOXES: TextBox[] = MEDICATION_SLIDES.flatMap((slide) =>
  slide.boxes.map((box, index) => ({ ...box, id: `seed-${slide.id}-${index}`, slide: slide.id })),
)
