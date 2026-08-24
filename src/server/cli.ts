import readline from 'readline';
import type { Server } from 'http';
import {
  createGroupChat,
  destroyGroupChat,
  clearAllGroupChats,
  type DB,
} from './db';

/**
 * Start the interactive admin CLI on stdin. `shutdown` closes the database and
 * exits; `server` is only used for the connection count in `status`.
 */
export function startCli({
  db,
  server,
  shutdown,
}: {
  db: DB;
  server: Server;
  shutdown: () => void;
}): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', async (line) => {
    const input = line.trim();
    const [command, ...args] = input.split(' ');

    switch (command.toLowerCase()) {
      case 'help':
        console.log(
          'Available commands: status, create, destroy, stop, db, msgclear, gcclear, promote'
        );
        break;
      case 'status':
        // Node's http.Server no longer exposes `.connections`; keep the fallback.
        const connections = (server as Server & { connections?: number }).connections;
        console.log(`Server status: ONLINE. Connections: ${connections ?? 0}`);
        break;
      case 'stop':
        console.log('Shutting down server gracefully...');
        shutdown();
        break;
      case 'promote':
        if (args.length < 1) {
          console.log('Usage: promote <username>');
        } else {
          const username = args.join(' ').trim();
          if (!username) {
            console.log('Usage: promote <username>');
          } else {
            await db.run(
              'UPDATE users SET is_admin = 1 WHERE username = ?',
              [username]
            );
            console.log(`${username} promoted to admin. They must re-login for it to take effect.`);
          }
        }
      case 'create':
        if (args.length < 2) {
          console.log('Usage: create <gc_id> <gc_name>');
        } else {
          const [gc_id, ...gc_name_parts] = args;
          const gc_name = gc_name_parts.join(' ');
          await createGroupChat(db, Number(gc_id), gc_name);
        }
        break;
      case 'destroy':
        if (args.length < 1) {
          console.log('Usage: destroy <gc_id>');
        } else {
          const [gc_id] = args;
          await destroyGroupChat(db, Number(gc_id));
        }
        break;
      case 'db':
        if (args.length < 1) {
          console.log('Usage: db <query>');
        } else {
          const query = args.join(' ');
          await db.run(query, []);
          console.log('Query executed successfully.');
        }
        break;
      case 'msgclear':
        if (args.length < 1) {
          await db.exec(`DELETE FROM messages`);
          console.log('Messages table cleared successfully.');
        } else {
          const query = `DELETE FROM messages WHERE group_chat_id = ?; DELETE FROM sqlite_sequence WHERE name='messages';`;
          await db.run(query, [args[0]]);
          console.log(
            `Messages for group chat ID ${args[0]} cleared successfully.`
          );
        }
        break;
      case 'gcclear':
        await clearAllGroupChats(db);
        break;
      default:
        console.log(`Unknown command: "${command}". Type "help" for options.`);
        break;
    }
  });

  return rl;
}
