"""Local fanservice pack delivery into the identified original v0.04 game."""
import json
from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from v004_pack_bridge import install, list_installed, uninstall


class PackBridge:
    def __init__(self, root):
        self.root = root
        self.results = queue.Queue()
        self.busy = False
        self.game = tk.StringVar()
        self.archive = tk.StringVar()
        self.installed = []
        self.operation = None
        root.title('fanservice · Send pack to v0.04')
        root.geometry('760x580')
        root.minsize(640, 580)
        frame = ttk.Frame(root, padding=20)
        frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='Send a saved pack into the original game',
                  font=('Segoe UI', 15, 'bold')).pack(anchor='w')
        ttk.Label(frame, text='Close the game first. This bridge supports the identified v0.04 Exclusive build.',
                  wraplength=650).pack(anchor='w', pady=(8, 16))
        self.controls = []
        for label, value, command in [('Game Windows folder containing CockHero', self.game, self.choose_game),
                                      ('Exported fanservice pack', self.archive, self.choose_archive)]:
            ttk.Label(frame, text=label).pack(anchor='w')
            row = ttk.Frame(frame)
            row.pack(fill='x', pady=(4, 12))
            entry = ttk.Entry(row, textvariable=value)
            entry.pack(side='left', fill='x', expand=True)
            button = ttk.Button(row, text='Browse', command=command)
            button.pack(side='right', padx=(8, 0))
            self.controls.extend([entry, button])
        button = ttk.Button(frame, text='Install pack for next game launch', command=self.start)
        button.pack(anchor='w', pady=(0, 12))
        self.controls.append(button)
        ttk.Label(frame, text='Previously installed packs').pack(anchor='w')
        self.pack_list = ttk.Combobox(frame, state='readonly')
        self.pack_list.pack(fill='x', pady=(4, 8))
        row = ttk.Frame(frame)
        row.pack(fill='x', pady=(0, 12))
        for label, command in [('Refresh installed packs', self.refresh),
                               ('Update selected pack', self.update_selected),
                               ('Remove selected pack', self.remove_selected)]:
            control = ttk.Button(row, text=label, command=command)
            control.pack(side='left', padx=(0, 8))
            self.controls.append(control)
        self.status = tk.StringVar(value='Choose the game folder and an exported .chpack or .chpack.zip.')
        ttk.Label(frame, textvariable=self.status, wraplength=650).pack(anchor='w')
        self.progress = ttk.Progressbar(frame, mode='indeterminate')
        self.progress.pack(fill='x', pady=12)
        root.protocol('WM_DELETE_WINDOW', self.close)
        root.after(100, self.poll)

    def choose_game(self):
        selected = filedialog.askdirectory(parent=self.root, title='Choose Windows folder containing CockHero')
        if selected:
            self.game.set(selected)

    def choose_archive(self):
        selected = filedialog.askopenfilename(parent=self.root, title='Choose exported fanservice pack',
                                             filetypes=[('Saved packs', '*.chpack *.zip'), ('All files', '*.*')])
        if selected:
            self.archive.set(selected)

    def start(self):
        if self.busy:
            return
        if not self.game.get().strip() or not self.archive.get().strip():
            messagebox.showerror('Choose both files', 'Choose the game folder and a saved pack.', parent=self.root)
            return
        game, archive = Path(self.game.get()), Path(self.archive.get())
        self.run('install', lambda: install(game, archive))

    def refresh(self):
        if not self.game.get().strip():
            messagebox.showerror('Choose game folder', 'Choose the game Windows folder first.', parent=self.root)
            return
        game = Path(self.game.get())
        self.run('list', lambda: list_installed(game))

    def selected(self):
        index = self.pack_list.current()
        if index < 0 or index >= len(self.installed):
            messagebox.showerror('Choose installed pack', 'Refresh and choose an installed pack first.', parent=self.root)
            return None
        return self.installed[index]

    def update_selected(self):
        selected = self.selected()
        if selected is None:
            return
        if not self.archive.get().strip():
            messagebox.showerror('Choose replacement archive', 'Choose the newly exported pack first.', parent=self.root)
            return
        game, archive, identity = Path(self.game.get()), Path(self.archive.get()), selected['custom_id']
        self.run('install', lambda: install(game, archive, custom_id=identity))

    def remove_selected(self):
        selected = self.selected()
        if selected is None:
            return
        if not messagebox.askyesno('Remove installed pack',
                                  'Remove this bridge-owned pack and its verified extracted cache? Native saves and ownership remain.',
                                  parent=self.root):
            return
        game, identity = Path(self.game.get()), selected['custom_id']
        self.run('remove', lambda: uninstall(game, identity))

    def run(self, operation, action):
        if self.busy:
            return
        self.busy = True
        self.operation = operation
        for control in self.controls:
            control.configure(state='disabled')
        self.pack_list.configure(state='disabled')
        self.progress.start()
        self.status.set('Checking the game build and archive. Large game files take time to verify.')

        def work():
            try:
                self.results.put((True, action()))
            except Exception as error:
                self.results.put((False, str(error)))

        threading.Thread(target=work, daemon=False).start()

    def poll(self):
        try:
            success, result = self.results.get_nowait()
        except queue.Empty:
            self.root.after(100, self.poll)
            return
        self.busy = False
        self.progress.stop()
        for control in self.controls:
            control.configure(state='normal')
        self.pack_list.configure(state='readonly')
        if success and self.operation == 'list':
            self.installed = result
            self.pack_list['values'] = [item['name'] + (' · verified' if item['integrity_verified'] else ' · changed or missing')
                                       + ' · ' + item['custom_id'] for item in result]
            if result:
                self.pack_list.current(0)
            else:
                self.pack_list.set('')
            self.status.set(str(len(result)) + ' bridge-owned packs. Close the game before updating or removing one.')
        elif success and self.operation == 'remove':
            self.installed = []
            self.pack_list['values'] = []
            self.pack_list.set('')
            self.status.set('Owned pack removed. Original packs and native saves remain. Refresh to reload installed packs.')
        elif success:
            self.status.set('Installed. Start the game, open Unlocks, then unlock and enable the pack.\n'
                            'Native price: ' + str(result['unlock_cost']) + ' UP. Media: ' + str(result['media_count']) + '.')
            self.show_receipt(result)
        else:
            self.status.set('Operation failed. ' + result)
            messagebox.showerror('Operation did not complete', result, parent=self.root)
        self.root.after(100, self.poll)

    def show_receipt(self, receipt):
        dialog = tk.Toplevel(self.root)
        dialog.title('Installed pack receipt')
        dialog.geometry('740x430')
        text = tk.Text(dialog, wrap='word', padx=12, pady=12)
        text.pack(fill='both', expand=True)
        text.insert('1.0', json.dumps(receipt, indent=2))
        text.configure(state='disabled')
        ttk.Label(dialog, text='Use Update selected pack to retain its native filename and identity.',
                  padding=10).pack()

    def close(self):
        if self.busy:
            messagebox.showinfo('Installation running', 'Wait for the archive verification and copy to finish.',
                                parent=self.root)
            return
        self.root.destroy()


if __name__ == '__main__':
    application = tk.Tk()
    PackBridge(application)
    application.mainloop()
