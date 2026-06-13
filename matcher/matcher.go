package matcher

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"webhook-orchestrator/config"
)

func MatchSource(src *config.Source, body []byte) []string {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var targets []string
	for i := range src.Rules {
		rule := &src.Rules[i]
		if matchRule(rule, payload) {
			for _, tid := range rule.TargetIDs {
				if !seen[tid] {
					seen[tid] = true
					targets = append(targets, tid)
				}
			}
		}
	}
	return targets
}

func matchRule(rule *config.Rule, payload map[string]interface{}) bool {
	if len(rule.Conditions) == 0 {
		return true
	}
	orMode := strings.EqualFold(rule.Logic, "OR")
	for i := range rule.Conditions {
		matched := matchCondition(&rule.Conditions[i], payload)
		if orMode && matched {
			return true
		}
		if !orMode && !matched {
			return false
		}
	}
	return !orMode
}

func matchCondition(c *config.Condition, payload map[string]interface{}) bool {
	fields := c.AnyField
	if c.Field != "" {
		fields = append([]string{c.Field}, fields...)
	}
	if len(fields) == 0 {
		return false
	}

	if c.Op == "not_exists" {
		for _, f := range fields {
			if _, ok := getField(payload, f); ok {
				return false
			}
		}
		return true
	}

	for _, f := range fields {
		val, ok := getField(payload, f)
		if !ok {
			continue
		}
		if evalOp(c.Op, val, c.Value, c.Values) {
			return true
		}
	}
	return false
}

func evalOp(op string, val interface{}, expected string, expectedList []string) bool {
	s := toString(val)

	switch op {
	case "eq", "":
		return s == expected
	case "ne":
		return s != expected
	case "contains":
		return strings.Contains(s, expected)
	case "not_contains":
		return !strings.Contains(s, expected)
	case "starts_with":
		return strings.HasPrefix(s, expected)
	case "ends_with":
		return strings.HasSuffix(s, expected)
	case "exists":
		return true
	case "in":
		list := expectedList
		if len(list) == 0 {
			list = splitCSV(expected)
		}
		for _, v := range list {
			if s == v {
				return true
			}
		}
		return false
	case "not_in":
		list := expectedList
		if len(list) == 0 {
			list = splitCSV(expected)
		}
		for _, v := range list {
			if s == v {
				return false
			}
		}
		return true
	case "regex", "matches":
		re, err := regexp.Compile(expected)
		if err != nil {
			return false
		}
		return re.MatchString(s)
	case "gt", "gte", "lt", "lte":
		return numCmp(s, op, expected)
	}
	return false
}

func numCmp(s, op, expected string) bool {
	a, err1 := strconv.ParseFloat(s, 64)
	b, err2 := strconv.ParseFloat(expected, 64)
	if err1 != nil || err2 != nil {
		return false
	}
	switch op {
	case "gt":
		return a > b
	case "gte":
		return a >= b
	case "lt":
		return a < b
	case "lte":
		return a <= b
	}
	return false
}

func getField(data map[string]interface{}, path string) (interface{}, bool) {
	idx := strings.IndexByte(path, '.')
	if idx < 0 {
		v, ok := data[path]
		return v, ok
	}
	key, rest := path[:idx], path[idx+1:]
	child, ok := data[key]
	if !ok {
		return nil, false
	}
	nested, ok := child.(map[string]interface{})
	if !ok {
		return nil, false
	}
	return getField(nested, rest)
}

func toString(val interface{}) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case bool:
		return fmt.Sprintf("%t", v)
	case float64:
		if v == float64(int64(v)) {
			return fmt.Sprintf("%d", int64(v))
		}
		return fmt.Sprintf("%g", v)
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}
