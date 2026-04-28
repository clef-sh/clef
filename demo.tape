# Clef CLI Demo
# Requires: vhs, clef, git, age-keygen

Output demo.gif

Set Shell "zsh"
Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Dracula"
Set Padding 20

# Setup
Type "mkdir -p my-app && cd my-app"
Enter
Sleep 500ms

# Step 0: git init
Type "git init"
Enter
Sleep 1s

# Step 1: clef init
Type "clef init"
Enter
Sleep 2s

Type "dev,prod"
Enter
Sleep 500ms

Type "auth,db"
Enter
Sleep 500ms

Enter
Sleep 1500ms

Type "git add . && git commit -m 'first commit'"
Enter
Sleep 2s

# Step 2: set a secret
Type "clef set auth/dev API_KEY"
Enter
Sleep 2s

Type "sk_test_abc123"
Enter
Sleep 2s

# Step 3: read it back
Type "clef get auth/dev API_KEY"
Enter
Sleep 2s

# Step 4: diff
Type "clef diff auth prod dev"
Enter
Sleep 2s

# Step 5: lint
Type "clef lint"
Enter
Sleep 5s

# Step 6: start ui
Type "clef ui"
Enter
Sleep 1s