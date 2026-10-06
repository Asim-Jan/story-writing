/**
 * Seed Template Books
 * Creates initial sample books for the template gallery
 * Run with: node server/db/seeds/templateBooks.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const templates = [
  {
    // FANTASY ADVENTURE
    title: 'The Dragon\'s Awakening',
    description: 'A young blacksmith discovers they are the last of an ancient lineage of dragon riders.',
    genre: 'Fantasy',
    target_audience: 'Young Adult',
    template_category: 'Fantasy',
    template_description: 'Epic fantasy adventure with dragons, magic, and a hero\'s journey. Perfect for high-fantasy stories with magical creatures and coming-of-age themes.',
    template_tags: ['Dragons', 'Magic', 'Hero\'s Journey', 'Medieval', 'Coming of Age'],
    template_order: 1,
    characters: [
      {
        id: Date.now() + 1,
        name: 'Kira Ironforge',
        role: 'Protagonist',
        age: '17',
        gender: 'Female',
        background: 'Raised as a blacksmith\'s apprentice in Ironforge Village, unaware of her true heritage',
        personality: 'Determined, compassionate, quick-witted',
        arc: 'From ordinary blacksmith to legendary dragon rider',
        motivations: 'Protect her village and honor her parents\' legacy',
        fears: 'Failing those who depend on her',
        quirks: 'Always carries her forging hammer, speaks to tools while working'
      },
      {
        id: Date.now() + 2,
        name: 'Ember',
        role: 'Dragon Companion',
        background: 'The last fire dragon, hatched from a stone that had been dormant for centuries',
        personality: 'Proud, wise beyond her years, fiercely protective',
        arc: 'Rediscovering trust in humans after centuries of betrayal',
        motivations: 'Restore the bond between dragons and riders',
        fears: 'Humans repeating the mistakes of the past'
      },
      {
        id: Date.now() + 3,
        name: 'Master Thorne',
        role: 'Mentor',
        age: '68',
        gender: 'Male',
        background: 'Former dragon rider who went into hiding after the Great Betrayal',
        personality: 'Wise, secretive, protective',
        arc: 'Revealing the truth about Kira\'s heritage and his own past',
        motivations: 'Keep Kira safe while preparing her for her destiny',
        fears: 'History repeating itself'
      }
    ],
    locations: [
      {
        id: Date.now() + 1,
        name: 'Ironforge Village',
        type: 'Settlement',
        description: 'A small mining village at the base of the Dragon Mountains, known for its skilled blacksmiths',
        significance: 'Kira\'s home and the starting point of her journey',
        atmosphere: 'Rustic and hardworking, with the constant ring of hammers on anvils'
      },
      {
        id: Date.now() + 2,
        name: 'The Sundered Peaks',
        type: 'Mountain Range',
        description: 'Ancient mountains where dragons once ruled, now filled with ruins and forgotten magic',
        significance: 'Location of the dragon sanctuary and the trials Kira must face',
        atmosphere: 'Majestic yet dangerous, with caves glowing with residual magic'
      },
      {
        id: Date.now() + 3,
        name: 'Crystalkeep',
        type: 'City',
        description: 'The capital city ruled by the Dragon Council, built from crystalline stone',
        significance: 'Political center and Kira\'s final destination',
        atmosphere: 'Grand and imposing, with towers that catch the light like prisms'
      }
    ],
    plotlines: [
      {
        id: Date.now() + 1,
        title: 'The Awakening',
        type: 'main',
        description: 'Kira discovers her connection to dragons when Ember hatches from a mysterious stone',
        status: 'in-progress',
        themes: 'Destiny, heritage, responsibility'
      },
      {
        id: Date.now() + 2,
        title: 'The Dark Rising',
        type: 'main',
        description: 'Ancient evil stirs in the mountains, threatening both dragons and humans',
        status: 'planning',
        themes: 'Good vs evil, unity, sacrifice'
      },
      {
        id: Date.now() + 3,
        title: 'Forbidden Bond',
        type: 'subplot',
        description: 'Kira develops feelings for a council member\'s son despite laws against dragon riders forming attachments',
        status: 'planning',
        themes: 'Love, duty, tradition vs change'
      }
    ],
    world_building: {
      magic_system: 'Elemental dragon magic bound to bloodlines - riders can channel their dragon\'s elemental power',
      history: 'Dragons and humans lived in harmony for millennia until the Great Betrayal 500 years ago led to near-extinction of both dragon riders and dragons',
      culture: 'Society is divided between those who remember the old ways and want to restore the bond, and those who fear dragons and want them destroyed',
      government: 'Ruled by the Dragon Council, a group of nobles who rose to power after the fall of the dragon riders'
    },
    chapters: [
      {
        chapter_number: 1,
        title: 'The Stone in the Forge',
        content: `The hammer fell with a rhythm Kira knew in her bones. Strike, turn, strike, turn. Each impact sent sparks dancing across the darkened forge, illuminating the sweat on her brow.

"You're getting better," Master Thorne called from his workbench, not looking up from the sword he was etching. "But you still hesitate before the final strike."

Kira paused, the hammer heavy in her hand. He was right, as always. There was something about that last blow, the one that would set the shape permanently, that made her second-guess herself.

"I just want to get it perfect," she said, plunging the half-formed horseshoe into the water. Steam hissed up in a cloud.

"Perfect is the enemy of done." Thorne finally looked up, his weathered face creasing with a smile. "Besides, you've got a visitor."

Before Kira could ask what he meant, a small boy burst through the forge door, his eyes wide with excitement.

"Miss Kira! Miss Kira! You have to come see! There's a stone in the old well, and it's glowing!"

Kira exchanged a glance with Master Thorne. His smile had vanished, replaced by something she'd never seen before: fear.

"Show me," she said, untying her leather apron.

The stone in the well was unlike anything she'd ever seen. Perfectly spherical, about the size of a man's head, it pulsed with an inner light that seemed to beat in time with her own heart. Without thinking, she reached for it.

"Kira, wait—" Master Thorne's warning came too late.

The moment her fingers touched the stone's surface, the world exploded into fire and light. Through the flames, she saw them: great wings, scales that shimmered like jewels, eyes that held the wisdom of ages. Dragons.

And in that moment, the stone cracked open, and everything changed.`,
        word_count: 328
      },
      {
        chapter_number: 2,
        title: 'The Hatching',
        content: `When Kira's vision cleared, she was on her back in the dirt, staring up at the evening sky. Master Thorne leaned over her, his face a mixture of concern and resignation.

"I was hoping we'd have more time," he said quietly.

But Kira wasn't listening. Her attention was fixed on the creature sitting on her chest. It was no bigger than a cat, with scales that shifted between crimson and gold in the fading light. Its eyes—ancient, knowing eyes—stared directly into hers.

"What... what is it?" she whispered, though somewhere deep inside, she already knew.

"A dragon." Thorne helped her sit up, careful not to disturb the small creature. "The last one, I suspect."

"But dragons are extinct. Everyone knows that."

"Is that what everyone knows?" A hint of his old humor returned. "Or is that what everyone was meant to believe?"

The dragon—already Kira was thinking of it as Ember, though she didn't know why—let out a small chirp and nuzzled against her palm. The touch sent warmth flooding through her, and with it, understanding. Not words, exactly, but feelings. Emotions. A bond forming between them that felt older than time itself.

"What happens now?" Kira asked.

Master Thorne looked toward the mountains, where the setting sun painted the peaks in shades of fire. "Now? Now you learn what it truly means to be a dragon rider. And pray that history doesn't repeat itself."`,
        word_count: 267
      },
      {
        chapter_number: 3,
        title: 'The Bond',
        content: `The dragon refused to leave her side. Master Thorne explained what he could: the ancient pact between dragons and humans, the betrayal that led to their near extinction, and the bloodline that connected Kira to the dragon riders of old.

"Your parents didn't die in a mining accident," he said, the words heavy with years of carried guilt. "They were the last dragon riders, hunted down by those who feared what they represented."

Kira felt her world tilting. Everything she thought she knew about herself, about her past, was built on lies.

"Why didn't you tell me?"

"To protect you. As long as you didn't know, as long as no dragon had claimed you, you were safe." He gestured to Ember, who was now curled up in Kira's lap, purring like an oversized cat. "But now... now everything changes."

As if in response, Ember raised her head and released a small puff of flame—barely more than a candle's flicker, but enough to illuminate the birthmark on Kira's wrist. A mark she'd always thought was just a stain from the forge.

In the firelight, it was clearly a dragon in flight.

"There are others who will sense the awakening," Thorne continued. "Some will want to help you. Others will want you dead. We need to reach the Sundered Peaks before they find you."

Kira looked down at the tiny dragon in her lap, then up at the mountains that had always been part of her horizon but never her destination.

"When do we leave?"

"At first light. Pack light, and bring your hammer. Where we're going, you'll need it."`,
        word_count: 293
      }
    ]
  },
  {
    // ROMANCE
    title: 'Letters from Yesterday',
    description: 'When a bookstore owner finds vintage love letters hidden in an old book, she sets out to reunite them with their intended recipient.',
    genre: 'Romance',
    target_audience: 'Adult',
    template_category: 'Romance',
    template_description: 'Contemporary romance with mystery elements and dual timeline structure. Perfect for heartfelt emotional journeys and second-chance love stories.',
    template_tags: ['Contemporary', 'Small Town', 'Second Chances', 'Emotional', 'Mystery'],
    template_order: 2,
    characters: [
      {
        id: Date.now() + 4,
        name: 'Emma Collins',
        role: 'Protagonist',
        age: '32',
        gender: 'Female',
        background: 'Owns The Turning Page bookshop after inheriting it from her grandmother',
        personality: 'Romantic, organized, guarded after a broken engagement',
        arc: 'Learning to open her heart again and believe in second chances',
        motivations: 'Find happiness and prove love can last',
        fears: 'Being hurt again, losing the bookstore',
        quirks: 'Recommends books based on people\'s auras, always has a book quote for every situation'
      },
      {
        id: Date.now() + 5,
        name: 'James Morrison',
        role: 'Love Interest',
        age: '34',
        gender: 'Male',
        background: 'Local architect who returned to Maplewood after his divorce',
        personality: 'Patient, creative, observant',
        arc: 'Overcoming fear of commitment and learning to trust again',
        motivations: 'Build something lasting, find peace',
        fears: 'Repeating past mistakes',
        quirks: 'Sketches buildings on napkins, drinks exactly three cups of coffee every morning'
      },
      {
        id: Date.now() + 6,
        name: 'Margaret Hayes',
        role: 'Supporting Character',
        age: '78',
        gender: 'Female',
        background: 'Longtime resident of Maplewood with a mysterious past',
        personality: 'Wise, mysterious, romantic at heart',
        arc: 'Revealing a long-held secret about first love',
        motivations: 'Right a past wrong before it\'s too late'
      }
    ],
    locations: [
      {
        id: Date.now() + 4,
        name: 'The Turning Page Bookshop',
        type: 'Business',
        description: 'A cozy independent bookstore in downtown Maplewood, filled with overstuffed armchairs and the scent of old books',
        significance: 'Emma\'s sanctuary and where the mystery begins',
        atmosphere: 'Warm, nostalgic, filled with literary treasures'
      },
      {
        id: Date.now() + 5,
        name: 'Maplewood Town Square',
        type: 'Public Space',
        description: 'Historic town center with a vintage clock tower and fountain',
        significance: 'Meeting place mentioned in the letters, where past and present converge',
        atmosphere: 'Charming small-town New England, timeless'
      }
    ],
    plotlines: [
      {
        id: Date.now() + 4,
        title: 'The Mystery',
        type: 'main',
        description: 'Tracking down the recipients of 50-year-old love letters and uncovering their story',
        status: 'in-progress',
        themes: 'Lost love, second chances, the power of words'
      },
      {
        id: Date.now() + 5,
        title: 'Unexpected Love',
        type: 'main',
        description: 'Emma and James grow closer while solving the mystery, despite both being afraid to risk their hearts',
        status: 'in-progress',
        themes: 'Healing, trust, taking chances'
      }
    ],
    world_building: {
      setting: 'Maplewood, a small New England town with strong sense of community and history',
      atmosphere: 'Cozy, nostalgic, and romantic with autumn leaves and coffee shops',
      time_period: 'Contemporary with flashbacks to 1970'
    },
    chapters: [
      {
        chapter_number: 1,
        title: 'The Discovery',
        content: `Emma loved the smell of old books. Not the musty odor of neglect, but that warm, vanilla-like scent of well-loved pages that had been turned by countless hands over the years.

She was unpacking a box of estate sale finds when she found it: a first edition of "The Great Gatsby," its dust jacket surprisingly intact. As she opened it to check the copyright page, something fluttered out.

The envelope was yellowed with age, addressed in elegant handwriting: "To my darling M—" The rest was smudged, illegible.

Inside, she found a letter dated June 15th, 1970.

"My dearest Margaret," it began.

Emma knew she shouldn't read it. These were private words, meant for someone else's eyes. But the romantic in her—the part she thought she'd successfully buried after her engagement fell apart last year—couldn't resist.

As she read, tears welled in her eyes. This wasn't just a love letter. It was a goodbye, filled with regret and longing and the promise of a love that transcended whatever was keeping them apart.

And at the bottom, a signature: "Forever yours, J."

Emma looked at the book again. There, barely visible on the inside cover, was a bookplate: "From the library of Margaret Hayes, Maplewood."

Margaret Hayes. Emma knew that name. She'd seen it just this morning on a check for a book order.

Margaret Hayes still lived in Maplewood.

The bell above the door chimed, startling her from her thoughts. She looked up to find James Morrison standing in the doorway, coffee in one hand and a rolled-up blueprint in the other.

"You look like you've seen a ghost," he said, his eyes crinkling with concern.

Emma glanced down at the letter, then back at James. Maybe she had.`,
        word_count: 295
      },
      {
        chapter_number: 2,
        title: 'The Architect',
        content: `"You want to do what?"

James set down his coffee cup and stared at Emma like she'd suggested they rob a bank.

"Return a love letter," Emma repeated patiently. They were sitting in the Morning Brew café, and she'd just explained about finding the letter. "It's been fifty years. Don't you think she deserves to know he never forgot her?"

"And you know this how? Maybe they're married to other people. Maybe reopening old wounds is the last thing either of them needs."

Emma had known James since they were kids, but they'd only reconnected when he moved back to Maplewood last year after his divorce. He'd become her go-to contractor for the bookstore's ongoing restoration.

"Or maybe," she said, leaning forward, "maybe this is a second chance. Maybe all this time, they've both been wondering 'what if?'"

James's expression softened. "You're a hopeless romantic, Emma Collins."

"Better than a hopeless cynic."

He laughed at that, the sound warming something inside her chest that she'd thought had frozen solid. "Fine. I'll help you. But only because I know you'll do it anyway, and I don't want you getting into trouble alone."

As he smiled at her across the table, Emma felt something shift. Something she definitely wasn't ready to name.

"Thank you," she said quietly. "It means a lot."

"Besides," James added, pulling out his phone, "I've always been curious about the Hayes estate. It's one of the original Victorian houses in town. If we're going to be playing detective, we might as well start with some architectural research."

Emma couldn't help but smile. This was why she liked him—his practical approach balanced her romantic tendencies perfectly.

"What?" James asked, catching her expression.

"Nothing. Just... I'm glad you moved back to town."

"Yeah," he said, his eyes holding hers for a moment longer than necessary. "Me too."`,
        word_count: 319
      }
    ]
  },
  {
    // SCI-FI
    title: 'Colony Drift',
    description: 'A generation ship\'s navigation officer discovers the ship\'s course has been altered, and they\'re headed toward something that shouldn\'t exist.',
    genre: 'Science Fiction',
    target_audience: 'Adult',
    template_category: 'Sci-Fi',
    template_description: 'Hard science fiction with mystery elements set on a generation ship. Perfect for space opera stories with existential themes and first contact scenarios.',
    template_tags: ['Space Opera', 'Mystery', 'Hard Sci-Fi', 'First Contact', 'Generation Ship'],
    template_order: 3,
    characters: [
      {
        id: Date.now() + 7,
        name: 'Lieutenant Mara Chen',
        role: 'Protagonist',
        age: '29',
        gender: 'Female',
        background: 'Third-generation navigation officer, raised on the Arcturus',
        personality: 'Analytical, duty-bound, curious',
        arc: 'From blind faith in the mission to questioning everything she knows',
        motivations: 'Uncover the truth, protect the colonists',
        fears: 'The mission was a lie from the beginning',
        quirks: 'Talks to the ship\'s AI like a friend, keeps a paper journal'
      },
      {
        id: Date.now() + 8,
        name: 'Dr. Elias Novak',
        role: 'Deuteragonist',
        age: '35',
        gender: 'Male',
        background: 'Ship\'s astrophysicist, known for unconventional theories',
        personality: 'Brilliant, eccentric, paranoid (with good reason)',
        arc: 'From dismissed outcast to validated truth-seeker',
        motivations: 'Prove his theories, prevent disaster',
        fears: 'Being ignored until it\'s too late'
      },
      {
        id: Date.now() + 9,
        name: 'Captain Sarah Winters',
        role: 'Antagonist',
        age: '52',
        gender: 'Female',
        background: 'Fourth captain of the Arcturus, following in her grandmother\'s footsteps',
        personality: 'Authoritative, secretive, pragmatic',
        arc: 'Hidden agenda slowly revealed',
        motivations: 'Complete the true mission at any cost'
      }
    ],
    locations: [
      {
        id: Date.now() + 6,
        name: 'The Arcturus',
        type: 'Spacecraft',
        description: 'Generation ship carrying 50,000 colonists in cryosleep, traveling for 200 years',
        significance: 'The entire world for the skeleton crew who remain awake',
        atmosphere: 'Cold, metallic, with constant hum of life support'
      },
      {
        id: Date.now() + 7,
        name: 'Navigation Deck',
        type: 'Ship Section',
        description: 'The ship\'s nerve center, filled with holographic displays and navigation computers',
        significance: 'Where Mara first discovers the course deviation',
        atmosphere: 'Sterile, efficient, bathed in blue light from displays'
      },
      {
        id: Date.now() + 8,
        name: 'The Anomaly',
        type: 'Space Phenomenon',
        description: 'Impossible structure detected in deep space—no radiation, no heat signature',
        significance: 'The ship\'s true destination',
        atmosphere: 'Unknown, but sensor data suggests it defies known physics'
      }
    ],
    plotlines: [
      {
        id: Date.now() + 6,
        title: 'The Course Deviation',
        type: 'main',
        description: 'Investigation into why the ship\'s course was altered 40 years ago',
        status: 'in-progress',
        themes: 'Truth, deception, hidden agendas'
      },
      {
        id: Date.now() + 7,
        title: 'The Conspiracy',
        type: 'main',
        description: 'Uncovering that the ship\'s mission was never about colonizing New Terra',
        status: 'planning',
        themes: 'Trust, authority, purpose'
      },
      {
        id: Date.now() + 8,
        title: 'First Contact',
        type: 'main',
        description: 'What awaits at the anomaly may change humanity forever',
        status: 'planning',
        themes: 'The unknown, evolution, destiny'
      }
    ],
    world_building: {
      technology: 'Near-future: cryosleep, fusion drives, AI assistants, quantum communications (limited)',
      society: 'Rigid hierarchy aboard ship, Earth abandoned 200 years ago due to climate collapse',
      physics: 'Hard science with one unexplained element: the anomaly that shouldn\'t exist',
      history: 'The Arcturus is one of twelve generation ships sent to colonize distant worlds'
    },
    chapters: [
      {
        chapter_number: 1,
        title: 'Course Deviation',
        content: `Mara Chen had checked the navigation logs ten thousand times. It was part of the routine. Every shift, every day, for the past three years since she'd awakened from cryosleep to serve her rotation as navigation officer.

The Arcturus was on course. It always had been. In 147 years, the ship had never deviated from its programmed trajectory toward New Terra, not by so much as a thousandth of a degree.

Until today.

"NAVCOM, run diagnostic on stellar positioning system," she commanded.

The ship's AI responded immediately, its voice calm and genderless: "Diagnostic complete. All systems operating within normal parameters."

"Then explain the discrepancy in my navigation plot."

"Please clarify: what discrepancy?"

Mara pulled up the holographic display, highlighting the course deviation. It was subtle—they'd trained her to spot anomalies this small—but it was there. A drift of 0.003 degrees that had accumulated over what looked like... she checked the timestamp... over the past forty years.

Forty years. That meant it started before her rotation, during the previous crew's watch.

"NAVCOM, display course history for the past fifty years."

"Access restricted. Please contact Captain Winters for authorization."

Mara felt a chill that had nothing to do with the temperature-controlled bridge. In three years, she'd never encountered a restricted file.

"On what authority is this restricted?"

"Captain's orders. Level One security clearance required."

Mara stared at the holographic display, at the slight but unmistakable deviation from their programmed course. They weren't heading to New Terra anymore.

So where were they going?`,
        word_count: 272
      },
      {
        chapter_number: 2,
        title: 'The Astrophysicist',
        content: `Dr. Elias Novak's quarters were exactly what Mara expected: cluttered, cramped, and covered in star charts. The man himself looked like he hadn't slept in days, his dark hair standing at odd angles.

"Lieutenant Chen." He didn't seem surprised to see her at 0300 hours. "You've noticed it too."

"Noticed what?"

"Don't play games. You're navigation. I'm astrophysics. We both look at the stars, just from different perspectives." He gestured to a display showing... something. Mara couldn't quite make sense of it.

"Is that—"

"Impossible?" Elias laughed, but there was no humor in it. "Yes. According to everything we know about physics, what I'm seeing in those sensor readings shouldn't exist. And yet..."

Mara leaned closer. The data showed a massive gravitational anomaly, but the spectrographic analysis was all wrong. No electromagnetic radiation, no heat signature, nothing that suggested it was a natural stellar object.

"How long have you known?"

"Six months. I've been trying to get the Captain to listen, but she keeps dismissing it as sensor drift." He met her eyes. "But you found something too, didn't you? Something that confirms we're heading straight for it."

Mara thought about the restricted files, the course deviation, the forty years of subtle changes.

"The ship's been heading toward this thing since before either of us woke up," she said slowly. "This isn't an accident. Someone deliberately changed our course."

"Not someone," Elias corrected. "The Captain. And I think she knows exactly what we're going to find."

They stared at each other in the dim light of his quarters, the weight of the revelation settling over them.

"We need proof," Mara said finally.

"Then we better move fast. We reach the anomaly in three months."`,
        word_count: 317
      }
    ]
  }
];

async function seedTemplates() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'story_user',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'story_writing',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connected to story_writing database');

    for (const template of templates) {
      try {
        const chapters = template.chapters;
        delete template.chapters;

        // Insert template book
        const result = await client.query(
          `INSERT INTO books (
            owner_id, title, description, genre, target_audience,
            is_template, template_category, template_description,
            template_tags, template_order,
            characters, locations, plotlines, world_building, metadata, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *`,
          [
            null, // Templates have no owner
            template.title,
            template.description,
            template.genre,
            template.target_audience,
            true,
            template.template_category,
            template.template_description,
            JSON.stringify(template.template_tags),
            template.template_order,
            JSON.stringify(template.characters),
            JSON.stringify(template.locations),
            JSON.stringify(template.plotlines),
            JSON.stringify(template.world_building),
            JSON.stringify({}),
            'completed'
          ]
        );

        const book = result.rows[0];
        console.log(`✓ Created template: ${book.title}`);

        // Insert chapters
        for (const chapterData of chapters) {
          await client.query(
            `INSERT INTO chapters (
              book_id, chapter_number, title, content, word_count, status
            )
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              book.id,
              chapterData.chapter_number,
              chapterData.title,
              chapterData.content,
              chapterData.word_count,
              'completed'
            ]
          );
        }

        // Update book stats
        await client.query(
          `UPDATE books SET
            chapter_count = $1,
            word_count = $2
           WHERE id = $3`,
          [
            chapters.length,
            chapters.reduce((sum, ch) => sum + ch.word_count, 0),
            book.id
          ]
        );

        console.log(`  ✓ Added ${chapters.length} chapters`);
      } catch (error) {
        console.error(`✗ Error creating template ${template.title}:`, error);
      }
    }

    console.log('\n✅ Template books seeded successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedTemplates();
