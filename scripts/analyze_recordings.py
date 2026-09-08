import zipfile, json, sqlite3, tempfile, os

files = [
    ('/Users/home/Downloads/remus-session-307b3a49.zip', 'Android'),
    ('/Users/home/Downloads/remus-43BCD0B7-98DD-42C8-BFE5-0419C76289C9.zip', 'iOS')
]

for zip_path, platform in files:
    print('='*70)
    print(f'ANALYZING {platform.upper()} ARCHIVE: {zip_path}')
    if not os.path.exists(zip_path):
        print('FILE NOT FOUND!')
        continue
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        print('Zip contents:', z.namelist())
        with tempfile.TemporaryDirectory() as td:
            z.extractall(td)
            
            manifest_data = None
            context_data = None
            db_paths = []
            
            for root, dirs, fnames in os.walk(td):
                for f in fnames:
                    fp = os.path.join(root, f)
                    if f.endswith('manifest.json') and not 'watch' in f:
                        with open(fp) as mf:
                            manifest_data = json.load(mf)
                    elif f == 'recording-context.json':
                        with open(fp) as cf:
                            context_data = json.load(cf)
                    elif f.endswith('.sqlite') and not 'watch' in f:
                        db_paths.append(('Phone SQLite', fp))
                    elif f.endswith('.zip') and 'watch' in f:
                        with zipfile.ZipFile(fp, 'r') as wz:
                            wtd = os.path.join(td, 'watch_extracted')
                            wz.extractall(wtd)
                            for wroot, wdirs, wfnames in os.walk(wtd):
                                for wf in wfnames:
                                    wfp = os.path.join(wroot, wf)
                                    if wf.endswith('manifest.json'):
                                        with open(wfp) as wmf:
                                            print('\n[Watch Manifest]')
                                            print(json.dumps(json.load(wmf), indent=2))
                                    elif wf.endswith('.sqlite'):
                                        db_paths.append(('Watch SQLite', wfp))

            if manifest_data:
                print('\n[Main Manifest]')
                print(json.dumps(manifest_data, indent=2))
            if context_data:
                print('\n[Recording Context]')
                print(json.dumps(context_data, indent=2))

            for label, dbp in db_paths:
                print(f'\n--- {label}: {os.path.basename(dbp)} ---')
                conn = sqlite3.connect(dbp)
                c = conn.cursor()
                c.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [t[0] for t in c.fetchall() if t[0] != 'android_metadata']
                
                for t in tables:
                    c.execute(f'SELECT count(*) FROM {t}')
                    cnt = c.fetchone()[0]
                    print(f'  Table {t}: {cnt} rows')
                    if cnt == 0:
                        continue
                    
                    c.execute(f'PRAGMA table_info({t})')
                    cols = [col[1] for col in c.fetchall()]
                    
                    if 'elapsed' in cols:
                        c.execute(f'SELECT min(elapsed), max(elapsed) FROM {t}')
                        t_min, t_max = c.fetchone()
                        dur = t_max - t_min
                        rate = (cnt - 1) / dur if dur > 0 else 0
                        print(f'    Time span: {t_min:.2f}s -> {t_max:.2f}s (duration: {dur:.2f}s, rate: {rate:.1f} Hz)')
                        
                        if 'motion' in t:
                            c.execute(f'SELECT elapsed FROM {t} ORDER BY elapsed ASC')
                            elapseds = [r[0] for r in c.fetchall()]
                            gaps = []
                            max_gap = 0
                            for i in range(1, len(elapseds)):
                                dt = elapseds[i] - elapseds[i-1]
                                if dt > max_gap:
                                    max_gap = dt
                                if dt > 0.1:
                                    gaps.append((elapseds[i-1], elapseds[i], dt))
                            print(f'    Max gap between samples: {max_gap*1000:.1f} ms')
                            print(f'    Number of gaps > 100ms: {len(gaps)}')
                            if gaps:
                                print('    First 3 gaps > 100ms:', [(f'{g[0]:.2f}s->{g[1]:.2f}s', f'{g[2]*1000:.1f}ms') for g in gaps[:3]])

                    if t in ('location', 'watch_location'):
                        c.execute(f'SELECT min(horizontal_accuracy), max(horizontal_accuracy), avg(horizontal_accuracy) FROM {t}')
                        h_acc = c.fetchone()
                        print(f'    Horizontal accuracy: min={h_acc[0]:.2f}m, max={h_acc[1]:.2f}m, avg={h_acc[2]:.2f}m')
                    
                    if t == 'watch_health':
                        c.execute('SELECT kind, count(*), min(value), max(value), avg(value) FROM watch_health GROUP BY kind')
                        for krow in c.fetchall():
                            print(f'    Health {krow[0]}: {krow[1]} samples, min={krow[2]:.1f}, max={krow[3]:.1f}, avg={krow[4]:.1f}')
