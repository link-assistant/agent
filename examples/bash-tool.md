# Example of Bash tool usage

```bash
konard@MacBook-Pro-Konstantin ~ % echo "Use shell to understand which OS is running on my computer." | agent
{
  "type": "step_start",
  "timestamp": 1763625912588,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bc907001qbpzGNxUW0caX3",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bc01a001DeGS36cut6FS96",
    "type": "step-start"
  }
}
{
  "type": "tool_use",
  "timestamp": 1763625913878,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bce02001fB220ak21dSxU3",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bc01a001DeGS36cut6FS96",
    "type": "tool",
    "callID": "call_06168681",
    "tool": "bash",
    "state": {
      "status": "completed",
      "input": {
        "command": "uname -a",
        "description": "Shows system information including OS"
      },
      "output": "Darwin MacBook-Pro-Konstantin.local 24.6.0 Darwin Kernel Version 24.6.0: Mon Aug 11 21:16:31 PDT 2025; root:xnu-11417.140.69.701.11~1/RELEASE_ARM64_T6030 arm64\n",
      "title": "uname -a",
      "metadata": {
        "output": "Darwin MacBook-Pro-Konstantin.local 24.6.0 Darwin Kernel Version 24.6.0: Mon Aug 11 21:16:31 PDT 2025; root:xnu-11417.140.69.701.11~1/RELEASE_ARM64_T6030 arm64\n",
        "exit": 0,
        "description": "Shows system information including OS"
      },
      "time": {
        "start": 1763625913871,
        "end": 1763625913878
      }
    }
  }
}
{
  "type": "step_finish",
  "timestamp": 1763625913912,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bce37001dkbVF22u70EvrS",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bc01a001DeGS36cut6FS96",
    "type": "step-finish",
    "reason": "tool-calls",
    "cost": 0,
    "tokens": {
      "input": 8273,
      "output": 40,
      "reasoning": 129,
      "cache": {
        "read": 2432,
        "write": 0
      }
    }
  }
}
{
  "type": "step_start",
  "timestamp": 1763625914813,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bd1b9001pEYs3TJYIMu7gw",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bce3a001qYMkG7G5C1CcnI",
    "type": "step-start"
  }
}
{
  "type": "text",
  "timestamp": 1763625915972,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bd5c2001TbUUoNkFemL42U",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bce3a001qYMkG7G5C1CcnI",
    "type": "text",
    "text": "macOS (Darwin kernel)",
    "time": {
      "start": 1763625915972,
      "end": 1763625915972
    }
  }
}
{
  "type": "step_finish",
  "timestamp": 1763625915974,
  "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
  "part": {
    "id": "prt_aa04bd645001sJ9VCSx7uuU1dj",
    "sessionID": "ses_55fb44022ffe84ngPkgvqNIu29",
    "messageID": "msg_aa04bce3a001qYMkG7G5C1CcnI",
    "type": "step-finish",
    "reason": "stop",
    "cost": 0,
    "tokens": {
      "input": 134,
      "output": 6,
      "reasoning": 150,
      "cache": {
        "read": 10816,
        "write": 0
      }
    }
  }
}
konard@MacBook-Pro-Konstantin ~ %
```
