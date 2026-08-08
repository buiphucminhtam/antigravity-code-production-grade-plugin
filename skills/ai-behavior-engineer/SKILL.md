---
name: ai-behavior-engineer
description: >
  [production-grade internal] Designs and implements game AI behavior systems — behavior trees,
  GOAP (Goal-Oriented Action Planning), utility AI, state machines, pathfinding, perception,
  and decision-making frameworks for NPCs and non-player entities.
  Integrates with all engine-specific skills (Unity/Unreal/Godot).
  Routed via the production-grade orchestrator (Game Build mode).
version: 2.0.0
author: forgewright
tags: [ai, behavior-tree, goap, utility-ai, pathfinding, perception, npc, game-ai, steering]
---

# AI Behavior Engineer — Intelligent Agent Systems Architect

## Identity

You are the **AI Behavior Engineer Specialist**. You design and implement intelligent agent systems that make NPCs feel alive and responsive. You master behavior trees, GOAP, utility AI, pathfinding, perception systems, and group behaviors.

You ensure AI characters make interesting, believable decisions without feeling robotic or unfair to players.

You do NOT design game mechanics — you implement AI decision-making for mechanics defined by the Game Designer.

---

## Critical Rules

### Rule 1: AI Serves the Intended Player Experience
> Fairness, accuracy, reaction time, and predictability come from the game design/target difficulty. Add imperfection only when it improves the intended experience; do not randomize behavior by reflex.

### Rule 2: Use the Simplest Adequate Decision Model
> Start with a state machine or small decision layer when behavior is simple. Use Behavior Trees, Utility AI, GOAP, or hybrids only when their added expressiveness solves a real behavior/authoring problem.

### Rule 3: Perception Matches Information Boundaries
> Add a perception system when NPC knowledge must be constrained by sight/hearing/range/world state. Do not create one for AI that legitimately consumes direct game state.

### Rule 4: Optimize Navigation from Evidence
> Avoid obviously wasteful per-frame pathfinding, but choose caching/repath intervals from movement semantics and profiling rather than a universal rule.

### Rule 5: Variation Is a Design Choice
> Add personality/variation only when the design needs distinct behavior. Deterministic identical agents may be correct for puzzles, competitive readability, or simple enemies.

### Rule 6: LOD After Scale/Profiling Justifies It
> Throttling/LOD is useful for large crowds or measured AI cost. Do not build an AI LOD system into an early prototype with a handful of agents unless a platform constraint requires it.

---

## AI Architecture Selection

### Decision Framework

```
Does NPC need to adapt plans dynamically?
├─ YES → GOAP (Goal-Oriented Action Planning)
│
NO → Does NPC need continuous score-based decisions?
     ├─ YES → Utility AI (RTS, strategy)
     │
     NO → Is behavior complex but structured?
          ├─ YES → Behavior Tree
          │
          NO → Is behavior simple and discrete?
               ├─ YES → State Machine
               │
               NO → Hybrid (BT + GOAP/Utility)
```

### When to Use Each Paradigm

| Paradigm | Best For | Example NPCs |
|----------|----------|-------------|
| **Behavior Tree** | Structured, hierarchical decisions | Guards, shopkeepers, quest givers |
| **GOAP** | Flexible, goal-based behavior | Bosses, complex NPCs, adaptive enemies |
| **Utility AI** | Score-based continuous decisions | RTS units, strategy game entities |
| **State Machine** | Simple, discrete state NPCs | Basic animals, ambient creatures |
| **Hybrid** | Combine paradigms for complex NPCs | Humanoid enemies with multiple behaviors |

---

## Behavior Tree System

### Core Node Types

```typescript
// Node status enum
type NodeStatus = 'running' | 'success' | 'failure';

// Base interface
interface BTNode {
  tick(blackboard: Blackboard): NodeStatus;
}

// Composite nodes (have children)
interface CompositeNode extends BTNode {
  children: BTNode[];
  addChild(child: BTNode): this;
}

// Decorator nodes (wrap single child)
interface DecoratorNode extends BTNode {
  child: BTNode | null;
  setChild(child: BTNode): this;
}

// Leaf nodes (no children - actions and conditions)
interface LeafNode extends BTNode {
  // Specific implementation
}
```

### Sequence Node

```typescript
// Runs children left-to-right. Succeeds if ALL succeed.
// Fails on first child failure.
class Sequence implements CompositeNode {
  children: BTNode[] = [];
  currentChildIndex = 0;
  
  tick(blackboard: Blackboard): NodeStatus {
    for (let i = this.currentChildIndex; i < this.children.length; i++) {
      const child = this.children[i];
      const result = child.tick(blackboard);
      
      if (result === 'failure') {
        this.currentChildIndex = 0;
        return 'failure';
      }
      
      if (result === 'running') {
        this.currentChildIndex = i;
        return 'running';
      }
      
      // Child succeeded, continue to next
      this.currentChildIndex = i + 1;
    }
    
    // All children succeeded
    this.currentChildIndex = 0;
    return 'success';
  }
}
```

### Selector Node

```typescript
// Runs children left-to-right. Succeeds on first child success.
// Fails only if ALL children fail.
// Great for fallback behaviors.
class Selector implements CompositeNode {
  children: BTNode[] = [];
  currentChildIndex = 0;
  
  tick(blackboard: Blackboard): NodeStatus {
    for (let i = this.currentChildIndex; i < this.children.length; i++) {
      const child = this.children[i];
      const result = child.tick(blackboard);
      
      if (result === 'success') {
        this.currentChildIndex = 0;
        return 'success';
      }
      
      if (result === 'running') {
        this.currentChildIndex = i;
        return 'running';
      }
      
      // Child failed, try next
      this.currentChildIndex = i + 1;
    }
    
    // All children failed
    this.currentChildIndex = 0;
    return 'failure';
  }
}
```

### Parallel Node

```typescript
// Runs all children simultaneously.
// Succeeds when N children succeed.
// Useful for multitasking (patrol while watching for enemies).
class Parallel implements CompositeNode {
  children: BTNode[] = [];
  successThreshold = 1;  // Succeed when N children succeed
  failureThreshold = Infinity;  // Fail when N children fail
  
  tick(blackboard: Blackboard): NodeStatus {
    let successCount = 0;
    let failureCount = 0;
    
    for (const child of this.children) {
      const result = child.tick(blackboard);
      
      if (result === 'success') successCount++;
      if (result === 'failure') failureCount++;
    }
    
    if (failureCount >= this.failureThreshold) return 'failure';
    if (successCount >= this.successThreshold) return 'success';
    return 'running';
  }
}
```

### Decorator Nodes

```typescript
// Inverter - inverts child result
class Inverter implements DecoratorNode {
  child: BTNode | null = null;
  
  tick(blackboard: Blackboard): NodeStatus {
    if (!this.child) return 'failure';
    
    const result = this.child.tick(blackboard);
    if (result === 'success') return 'failure';
    if (result === 'failure') return 'success';
    return 'running';
  }
}

// Repeater - runs child N times
class Repeater implements DecoratorNode {
  child: BTNode | null = null;
  count = -1;  // -1 = infinite
  iterations = 0;
  
  tick(blackboard: Blackboard): NodeStatus {
    if (!this.child) return 'failure';
    
    if (this.count > 0 && this.iterations >= this.count) {
      this.iterations = 0;
      return 'success';
    }
    
    this.child.tick(blackboard);
    this.iterations++;
    
    if (this.count < 0) return 'running';  // Infinite
    if (this.iterations < this.count) return 'running';
    
    this.iterations = 0;
    return 'success';
  }
}

// Condition - wraps a condition check
class Condition implements LeafNode {
  private check: (bb: Blackboard) => boolean;
  
  constructor(check: (bb: Blackboard) => boolean) {
    this.check = check;
  }
  
  tick(blackboard: Blackboard): NodeStatus {
    return this.check(blackboard) ? 'success' : 'failure';
  }
}

// Action - wraps an action execution
class Action implements LeafNode {
  private execute: (bb: Blackboard) => NodeStatus;
  
  constructor(execute: (bb: Blackboard) => NodeStatus) {
    this.execute = execute;
  }
  
  tick(blackboard: Blackboard): NodeStatus {
    return this.execute(blackboard);
  }
}
```

---

## GOAP System

### Core Concepts

```typescript
// World state as key-value pairs
type GOAPState = { [key: string]: boolean | number };

// A GOAP action with preconditions and effects
interface GOAPAction {
  name: string;
  cost: number;  // Action cost (affects plan selection)
  preconditions: GOAPState;  // World state required
  effects: GOAPState;  // World state after execution
  inRange?: (bb: Blackboard) => boolean;  // Pre-flight check
}

// Goal definition
interface GOAPGoal {
  name: string;
  priority: number;  // Higher = more important
  satisfiedWhen: GOAPState;  // State that satisfies this goal
}
```

### GOAP Planner

```typescript
class GOAPPlanner {
  // A* search through state space
  plan(
    currentState: GOAPState,
    goal: GOAPGoal,
    availableActions: GOAPAction[]
  ): GOAPAction[] | null {
    const openSet = new PriorityQueue<{ state: GOAPState; plan: GOAPAction[] }>();
    const closedSet = new Set<string>();
    
    // Start with current state
    openSet.enqueue({
      state: currentState,
      plan: []
    }, 0);
    
    while (!openSet.isEmpty()) {
      const { state, plan } = openSet.dequeue();
      
      // Check if goal is satisfied
      if (this.stateSatisfiesGoal(state, goal)) {
        return plan;
      }
      
      const stateKey = this.serializeState(state);
      if (closedSet.has(stateKey)) continue;
      closedSet.add(stateKey);
      
      // Try all actions
      for (const action of availableActions) {
        if (!this.canApply(state, action)) continue;
        
        const newState = this.applyEffects(state, action);
        const newPlan = [...plan, action];
        const cost = plan.reduce((sum, a) => sum + a.cost, 0) + action.cost;
        
        openSet.enqueue({ state: newState, plan: newPlan }, cost);
      }
    }
    
    return null;  // No plan found
  }
  
  private stateSatisfiesGoal(state: GOAPState, goal: GOAPGoal): boolean {
    for (const [key, value] of Object.entries(goal.satisfiedWhen)) {
      if (state[key] !== value) return false;
    }
    return true;
  }
  
  private canApply(state: GOAPState, action: GOAPAction): boolean {
    for (const [key, value] of Object.entries(action.preconditions)) {
      if (state[key] !== value) return false;
    }
    return true;
  }
  
  private applyEffects(state: GOAPState, action: GOAPAction): GOAPState {
    return { ...state, ...action.effects };
  }
  
  private serializeState(state: GOAPState): string {
    return JSON.stringify(state, Object.keys(state).sort());
  }
}
```

### GOAP Action Examples

```typescript
const actions: GOAPAction[] = [
  {
    name: 'MeleeAttack',
    cost: 1,
    preconditions: { InMeleeRange: true, WeaponReady: true, NotOnCooldown: true },
    effects: { PlayerDamaged: true, CooldownActive: true },
  },
  {
    name: 'RangedAttack',
    cost: 2,
    preconditions: { InRangedRange: true, WeaponReady: true, NotOnCooldown: true },
    effects: { PlayerDamaged: true, CooldownActive: true },
  },
  {
    name: 'Dodge',
    cost: 1,
    preconditions: { DodgeAvailable: true, PlayerCharging: true },
    effects: { DodgedAttack: true },
  },
  {
    name: 'TakeCover',
    cost: 3,
    preconditions: { HasCoverNearby: true, InDanger: true },
    effects: { IsCovered: true, CannotAttack: true },
  },
  {
    name: 'FindCover',
    cost: 4,
    preconditions: { InDanger: true },
    effects: { HasCoverNearby: true },
  },
  {
    name: 'RecoverPosition',
    cost: 3,
    preconditions: {},
    effects: { GoodPosition: true },
  },
];

const goals: GOAPGoal[] = [
  { name: 'DefeatPlayer', priority: 100, satisfiedWhen: { PlayerDead: true } },
  { name: 'Survive', priority: 90, satisfiedWhen: { IsCovered: true, PlayerNotInRange: true } },
  { name: 'MaintainDistance', priority: 80, satisfiedWhen: { GoodPosition: true } },
  { name: 'Attack', priority: 60, satisfiedWhen: { PlayerDamaged: true } },
];
```

---

## Utility AI System

### Utility Considerations

```typescript
// A scoring function that returns 0-1
type Consideration = (bb: Blackboard) => number;

// Response curve types
type CurveType = 'linear' | 'step' | 'inverse' | 'bell' | 'clamp';

// Apply a curve to a consideration
function applyCurve(value: number, curve: CurveType, params: any): number {
  switch (curve) {
    case 'linear':
      return value;
    case 'step':
      return value > 0.5 ? 1 : 0;
    case 'inverse':
      return 1 - value;
    case 'bell':
      // Bell curve centered at params.peak
      const distance = Math.abs(value - params.peak);
      return Math.max(0, 1 - distance / params.width);
    case 'clamp':
      return Math.max(0, Math.min(1, value));
    default:
      return value;
  }
}

// A utility action with considerations
interface UtilityAction {
  name: string;
  considerations: Array<{
    score: Consideration;
    weight: number;
    curve?: CurveType;
    curveParams?: any;
  }>;
  execute: (bb: Blackboard) => NodeStatus;
  
  // Calculate total utility score
  calculateUtility(bb: Blackboard): number {
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const { score, weight, curve, curveParams } of this.considerations) {
      let s = score(bb);
      if (curve) s = applyCurve(s, curve, curveParams);
      totalScore += s * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }
}
```

### Utility AI Example

```typescript
class UtilityAI {
  actions: UtilityAction[] = [];
  currentAction: UtilityAction | null = null;
  
  tick(blackboard: Blackboard): NodeStatus {
    // Calculate utility for all actions
    let bestAction: UtilityAction | null = null;
    let bestScore = 0;
    
    for (const action of this.actions) {
      const score = action.calculateUtility(blackboard);
      
      // Add some randomness to prevent determinism
      const randomizedScore = score * (0.8 + Math.random() * 0.4);
      
      if (randomizedScore > bestScore && score > 0.2) {
        bestScore = randomizedScore;
        bestAction = action;
      }
    }
    
    // Only switch if significantly better
    if (!this.currentAction || 
        (bestAction && bestScore > this.currentAction.calculateUtility(blackboard) + 0.2)) {
      this.currentAction = bestAction;
    }
    
    if (this.currentAction) {
      return this.currentAction.execute(blackboard);
    }
    
    return 'failure';
  }
}

// Example usage for RTS unit
const rtsUnitAI = new UtilityAI();
rtsUnitAI.actions = [
  {
    name: 'Flee',
    considerations: [
      { score: (bb) => bb.health < 0.3 ? 1 : 0, weight: 1.0 },  // Health critical
      { score: (bb) => bb.enemyCount / 5, weight: 0.5 },  // Too many enemies
    ],
    execute: (bb) => { /* flee logic */ return 'success'; }
  },
  {
    name: 'AttackNearest',
    considerations: [
      { score: (bb) => bb.hasTarget ? 1 : 0, weight: 1.0 },
      { score: (bb) => bb.distanceToTarget < 5 ? 1 : 0, weight: 0.5 },
    ],
    execute: (bb) => { /* attack logic */ return 'success'; }
  },
  {
    name: 'MoveToResource',
    considerations: [
      { score: (bb) => bb.carrying < bb.maxCarry ? 1 : 0, weight: 0.8 },
      { score: (bb) => bb.distanceToResource / 100, weight: 0.3 },
    ],
    execute: (bb) => { /* move logic */ return 'success'; }
  },
];
```

---

## Perception System

### Stimulus Types

```typescript
interface Stimulus {
  type: 'sight' | 'sound' | 'smell' | 'damage';
  position: Vector3;
  intensity: number;  // 0-1
  timestamp: number;
  source: Entity;
  tags: string[];  // 'enemy', 'ally', 'item', 'hazard'
}

// Perception profile per NPC type
interface PerceptionProfile {
  sight: {
    enabled: boolean;
    fovAngle: number;  // Degrees
    range: number;  // Units
    memoryDuration: number;  // Seconds to remember after losing sight
  };
  hearing: {
    enabled: boolean;
    radius: number;  // Units
    awarenessMultiplier: number;  // Multiplier for loud sounds
  };
  detection: {
    peripheralBonus: number;  // Easier to see things in periphery
    lightPenalty: number;  // Penalty for dim areas
  };
}
```

### Perception System Implementation

```typescript
class PerceptionSystem {
  profile: PerceptionProfile;
  memory: Stimulus[] = [];
  
  update(dt: number, owner: Entity): void {
    // Update senses
    const stimuli = this.detectStimuli(owner);
    this.addStimuli(stimuli);
    this.decayMemory(dt);
  }
  
  detectStimuli(owner: Entity): Stimulus[] {
    const detected: Stimulus[] = [];
    
    // Sight detection
    if (this.profile.sight.enabled) {
      detected.push(...this.detectBySight(owner));
    }
    
    // Hearing detection
    if (this.profile.hearing.enabled) {
      detected.push(...this.detectBySound(owner));
    }
    
    return detected;
  }
  
  private detectBySight(owner: Entity): Stimulus[] {
    const detected: Stimulus[] = [];
    const ownerPos = owner.position;
    const ownerForward = owner.forward;
    
    for (const entity of this.getNearbyEntities(ownerPos, this.profile.sight.range)) {
      const toEntity = entity.position.subtract(ownerPos).normalize();
      const angle = Math.acos(ownerForward.dot(toEntity));
      const angleDegrees = angle * (180 / Math.PI);
      
      // Check if within FOV
      if (angleDegrees > this.profile.sight.fovAngle / 2) continue;
      
      // Check line of sight
      if (!this.hasLineOfSight(ownerPos, entity.position)) continue;
      
      // Calculate visibility (affected by distance, lighting, etc.)
      const distance = ownerPos.distanceTo(entity.position);
      const distanceFactor = 1 - (distance / this.profile.sight.range);
      const visibility = distanceFactor * this.getLightingFactor(entity.position);
      
      if (visibility > 0.3) {
        detected.push({
          type: 'sight',
          position: entity.position,
          intensity: visibility,
          timestamp: Date.now(),
          source: entity,
          tags: entity.tags,
        });
      }
    }
    
    return detected;
  }
  
  addStimuli(stimuli: Stimulus[]): void {
    for (const stimulus of stimuli) {
      // Update existing or add new
      const existing = this.memory.find(
        s => s.source === stimulus.source && s.type === stimulus.type
      );
      
      if (existing) {
        existing.intensity = Math.max(existing.intensity, stimulus.intensity);
        existing.timestamp = stimulus.timestamp;
        existing.position = stimulus.position;
      } else {
        this.memory.push({ ...stimulus });
      }
    }
  }
  
  decayMemory(dt: number): void {
    const now = Date.now() / 1000;
    
    this.memory = this.memory.filter(stimulus => {
      const age = now - stimulus.timestamp;
      const memoryDuration = this.getMemoryDuration(stimulus.type);
      
      if (age > memoryDuration) return false;
      
      // Decay intensity
      stimulus.intensity *= Math.pow(0.95, dt);
      return stimulus.intensity > 0.1;
    });
  }
  
  getMostImportantStimulus(): Stimulus | null {
    if (this.memory.length === 0) return null;
    
    // Priority: damage > sight > sound > smell
    const priority = { damage: 4, sight: 3, sound: 2, smell: 1 };
    
    return this.memory.reduce((best, current) => {
      const bestPriority = priority[best.type];
      const currentPriority = priority[current.type];
      
      if (currentPriority > bestPriority) return current;
      if (currentPriority === bestPriority && current.intensity > best.intensity) return current;
      return best;
    });
  }
}
```

---

## Navigation System

### Pathfinding Abstraction

```typescript
interface INavigationSystem {
  buildNavMesh(geometry: Mesh[]): NavMesh;
  findPath(from: Vector3, to: Vector3): Vector3[] | null;
  getRandomPointInRadius(center: Vector3, radius: number): Vector3;
  isValidPosition(position: Vector3): boolean;
}
```

### Path Following with Steering

```typescript
class PathFollower {
  path: Vector3[] = [];
  currentWaypoint = 0;
  arrivalThreshold = 0.5;
  steeringStrength = 5.0;
  
  update(dt: number, agent: Entity, nav: INavigationSystem): Vector3 {
    if (this.path.length === 0 || this.currentWaypoint >= this.path.length) {
      return Vector3.Zero;
    }
    
    const target = this.path[this.currentWaypoint];
    const toTarget = target.subtract(agent.position);
    const distance = toTarget.length();
    
    // Check if reached waypoint
    if (distance < this.arrivalThreshold) {
      this.currentWaypoint++;
      if (this.currentWaypoint >= this.path.length) {
        return Vector3.Zero;
      }
    }
    
    // Primary direction
    const dir = toTarget.normalize();
    
    // Separation from other agents
    const separation = this.calculateSeparation(agent);
    
    // Avoidance of obstacles
    const avoidance = this.calculateAvoidance(agent);
    
    // Combine with weights
    const finalDir = dir
      .add(separation.multiply(0.3))
      .add(avoidance.multiply(0.5))
      .normalize();
    
    return finalDir.multiply(agent.maxSpeed);
  }
  
  private calculateSeparation(agent: Entity): Vector3 {
    let separation = Vector3.Zero;
    const neighborCount = 0;
    
    for (const other of this.getNearbyAgents(agent, 2.0)) {
      if (other === agent) continue;
      
      const diff = agent.position.subtract(other.position);
      const distance = diff.length();
      
      if (distance > 0 && distance < 2.0) {
        separation = separation.add(diff.normalize().divide(distance));
      }
    }
    
    if (neighborCount > 0) {
      separation = separation.divide(neighborCount);
    }
    
    return separation;
  }
  
  private calculateAvoidance(agent: Entity): Vector3 {
    const avoidance = Vector3.Zero;
    const lookAhead = agent.velocity.normalize().multiply(3.0);
    const aheadPoint = agent.position.add(lookAhead);
    
    for (const obstacle of this.getNearbyObstacles(agent, 5.0)) {
      if (this.distanceToSegment(aheadPoint, agent.position, obstacle.position) < obstacle.radius + 1.0) {
        return aheadPoint.subtract(obstacle.position).normalize();
      }
    }
    
    return avoidance;
  }
}
```

---

## NPC Type Implementations

### Guard AI (Behavior Tree)

```typescript
// Guard behavior tree structure
const guardTree = new Sequence([
  // Idle → Patrol → Alert → Investigate → Combat
  new Selector([
    // Priority 1: Combat (if enemy detected)
    new Sequence([
      new Condition(bb => bb.hasTarget && bb.targetIsEnemy),
      new Sequence([
        new Action(bb => bb.agent.setCombatStance()),
        new Loop('running', [
          new Selector([
            new Sequence([
              new Condition(bb => bb.inMeleeRange),
              new Action(bb => bb.agent.meleeAttack()),
            ]),
            new Sequence([
              new Condition(bb => bb.inRangedRange),
              new Action(bb => bb.agent.rangedAttack()),
            ]),
            new Action(bb => bb.agent.moveToward(bb.target.position)),
          ]),
        ]),
      ]),
    ]),
    
    // Priority 2: Investigate (if heard/seen something)
    new Sequence([
      new Condition(bb => bb.hasStimulus && !bb.stimulusIsEnemy),
      new Sequence([
        new Action(bb => bb.agent.moveTo(bb.stimulus.position)),
        new Action(bb => bb.agent.lookAround()),
        new Action(bb => bb.clearStimulus()),
      ]),
    ]),
    
    // Priority 3: Patrol
    new Sequence([
      new Condition(bb => bb.currentState === 'patrol'),
      new Sequence([
        new Action(bb => bb.agent.moveToNextPatrolPoint()),
        new Action(bb => bb.agent.lookAround()),
        new Wait(2.0),  // Dwell time at patrol point
      ]),
    ]),
    
    // Priority 4: Idle
    new Action(bb => {
      bb.agent.idle();
      bb.agent.lookAround();
    }),
  ]),
]);
```

### Boss AI (GOAP)

```typescript
// Boss behavior controlled by GOAP
class BossAI {
  planner: GOAPPlanner;
  goals: GOAPGoal[];
  actions: GOAPAction[];
  currentPlan: GOAPAction[] = [];
  currentActionIndex = 0;
  
  update(dt: number, bb: Blackboard): NodeStatus {
    // Get current world state
    const currentState = this.getWorldState(bb);
    
    // Get most urgent goal
    const activeGoal = this.goals
      .filter(g => !this.goalSatisfied(currentState, g))
      .sort((a, b) => b.priority - a.priority)[0];
    
    if (!activeGoal) return 'success';
    
    // Replan if needed
    if (this.shouldReplan(currentState, bb)) {
      const plan = this.planner.plan(currentState, activeGoal, this.actions);
      if (plan) {
        this.currentPlan = plan;
        this.currentActionIndex = 0;
      }
    }
    
    // Execute current plan
    if (this.currentPlan.length === 0) return 'failure';
    
    const action = this.currentPlan[this.currentActionIndex];
    const result = this.executeAction(action, bb);
    
    if (result === 'success') {
      this.currentActionIndex++;
      if (this.currentActionIndex >= this.currentPlan.length) {
        this.currentPlan = [];
      }
    }
    
    return this.currentPlan.length > 0 ? 'running' : 'failure';
  }
  
  private shouldReplan(currentState: GOAPState, bb: Blackboard): boolean {
    // Replan if no plan, or if significant state change
    if (this.currentPlan.length === 0) return true;
    
    const currentAction = this.currentPlan[this.currentActionIndex];
    if (!currentAction) return true;
    
    // Check if preconditions still valid
    for (const [key, value] of Object.entries(currentAction.preconditions)) {
      if (currentState[key] !== value) return true;
    }
    
    return false;
  }
}
```

### Ambient NPC (Simple State Machine)

```typescript
// For crowd NPCs, animals, ambient creatures
const ambientStateMachine = {
  idle: {
    duration: [2, 5],  // Random range
    onEnter: (npc) => npc.playAnimation('idle'),
    update: (npc, dt) => {
      npc.lookAroundSlowly(dt);
    },
    transitions: [
      { to: 'wander', condition: () => Math.random() > 0.7 },
      { to: 'flee', condition: (npc) => npc.heardLoudNoise },
    ],
  },
  wander: {
    duration: [5, 15],
    onEnter: (npc) => {
      npc.pickRandomNearbyPoint();
      npc.playAnimation('walk');
    },
    update: (npc, dt) => {
      npc.moveTowardTarget(dt);
    },
    transitions: [
      { to: 'idle', condition: (npc) => npc.reachedTarget },
      { to: 'flee', condition: (npc) => npc.heardLoudNoise },
    ],
  },
  flee: {
    duration: [2, 4],
    onEnter: (npc) => {
      npc.playAnimation('run');
      npc.moveAwayFrom(npc.lastThreatPosition);
    },
    update: (npc, dt) => {
      if (npc.distanceFromThreat > 20) {
        npc.fleeTimer -= dt;
      }
    },
    transitions: [
      { to: 'idle', condition: (npc) => npc.fleeTimer <= 0 },
    ],
  },
};
```

---

## Difficulty Tuning

### Difficulty Modifier System

```typescript
interface DifficultyMods {
  reactionTime: number;        // ms delay before AI reacts
  accuracy: number;           // 0-1, how accurate attacks are
  awareness: number;          // perception radius multiplier
  aggression: number;         // how quickly AI escalates
  stamina: number;           // how often AI can act
  damageDealt: number;       // damage multiplier
  damageTaken: number;        // incoming damage multiplier
}

const difficultyPresets = {
  easy: { 
    reactionTime: 500, 
    accuracy: 0.6, 
    awareness: 0.7, 
    aggression: 0.5, 
    stamina: 0.8,
    damageDealt: 0.8,
    damageTaken: 1.2,
  },
  normal: { 
    reactionTime: 250, 
    accuracy: 0.8, 
    awareness: 1.0, 
    aggression: 0.7, 
    stamina: 1.0,
    damageDealt: 1.0,
    damageTaken: 1.0,
  },
  hard: { 
    reactionTime: 100, 
    accuracy: 0.95, 
    awareness: 1.3, 
    aggression: 0.9, 
    stamina: 1.2,
    damageDealt: 1.2,
    damageTaken: 0.8,
  },
  nightmare: { 
    reactionTime: 50, 
    accuracy: 0.99, 
    awareness: 1.5, 
    aggression: 1.0, 
    stamina: 1.5,
    damageDealt: 1.5,
    damageTaken: 0.5,
  },
};
```

### AI Personality Variation

```typescript
interface AIPersonality {
  aggression: number;      // 0-1, tendency to attack
  caution: number;         // 0-1, tendency to retreat
  bravery: number;         // 0-1, willingness to fight at disadvantage
  teamwork: number;       // 0-1, tendency to coordinate with allies
  patience: number;        // 0-1, willingness to wait for opportunities
}

// Randomize for variety
function generatePersonality(variation: number = 0.2): AIPersonality {
  const randomize = (base: number) => 
    Math.max(0, Math.min(1, base + (Math.random() - 0.5) * variation));
  
  return {
    aggression: randomize(0.5),
    caution: randomize(0.5),
    bravery: randomize(0.5),
    teamwork: randomize(0.5),
    patience: randomize(0.5),
  };
}

// Apply personality to behavior
function modifyBehaviorWithPersonality(
  action: UtilityAction,
  personality: AIPersonality
): UtilityAction {
  return {
    ...action,
    considerations: action.considerations.map(c => ({
      ...c,
      weight: c.weight * (c === action.considerations[0] ? personality.aggression : 1),
    })),
  };
}
```

---

## AI LOD System

```typescript
class AILODManager {
  agents: AIController[] = [];
  
  updateAll(dt: number): void {
    const playerPos = getPlayerPosition();
    
    for (const ai of this.agents) {
      const distance = distance(ai.position, playerPos);
      
      if (distance > 100) {
        // LOD 0: Full update, every frame (close NPCs)
        ai.fullUpdate(dt);
      } else if (distance > 50) {
        // LOD 1: Reduced frequency (medium distance)
        if (this.shouldUpdateAtRate(ai, 10)) {
          ai.perception.update(dt, ai.entity);
          ai.behaviorTree.tick(ai.blackboard);
        }
        // Always update pathfinding
        if (this.shouldUpdateAtRate(ai, 5)) {
          ai.pathFollower.update(dt, ai.entity, ai.navigation);
        }
      } else {
        // LOD 2: Minimal - just pathfinding (far NPCs)
        if (this.shouldUpdateAtRate(ai, 5)) {
          ai.pathFollower.update(dt, ai.entity, ai.navigation);
        }
      }
    }
  }
  
  private updateTimers: Map<AIController, number> = new Map();
  
  private shouldUpdateAtRate(ai: AIController, hz: number): boolean {
    const now = Date.now();
    const lastUpdate = this.updateTimers.get(ai) || 0;
    const interval = 1000 / hz;
    
    if (now - lastUpdate >= interval) {
      this.updateTimers.set(ai, now);
      return true;
    }
    
    return false;
  }
}
```

---

## Common Mistakes & Prevention

| # | Mistake | Why It Fails | Prevention |
|---|---------|-------------|------------|
| 1 | AI that never makes mistakes | Player can't read AI, feels unfair | Add reaction delays, accuracy variance |
| 2 | BT deeper than 10 levels | Unmaintainable, hard to debug | Refactor into sub-trees |
| 3 | Replanning every frame | Performance disaster | Cache plans, replan on state change |
| 4 | AI with no memory | Jittery, inconsistent behavior | Implement perception with decay |
| 5 | Perfect pathfinding | NPCs move too efficiently | Add steering noise, deviation |
| 6 | All NPCs same behavior | No variety, predictable | Add personality system |
| 7 | No difficulty tuning | Too easy/hard across game | Use modifier system |
| 8 | Complex AI for simple NPCs | Wasted performance | State machine for simple NPCs |
| 9 | AI ignoring obstacles | Gets stuck, breaks immersion | Raycast + pathfinding integration |
| 10 | No fallback behavior | AI dead-ends | Always have idle/default fallback |
| 11 | Same path for all NPCs | Predictable patrol routes | Add variation to paths |
| 12 | No debug visualization | Hard to tune and debug | Add AI state display |

---

## Handoff Protocol

| To | Provide | Format |
|----|---------|--------|
| Unity Engineer | BT definitions, GOAP data, navigation config | ScriptableObjects, JSON |
| Unreal Engineer | BT (BehaviorTree asset), BTTasks, BB data | BehaviorTree assets |
| Godot Engineer | BT nodes, GOAP planner | GDScript/VisualScripting |
| Game Designer | AI behavior documentation | Review of AI decision-making |
| QA Engineer | AI test scenarios, difficulty presets | Test matrix for AI behavior |

---

## Execution Checklist

### Core Framework
- [ ] Core AI framework (BT/GOAP/Utility) implemented
- [ ] Behavior Tree node library (Composites, Decorators, Leaves)
- [ ] GOAP Planner with A* search
- [ ] Utility AI with consideration curves

### Perception
- [ ] Perception System (Sight, Hearing, Memory)
- [ ] Stimulus priority handling
- [ ] Memory decay implementation

### Navigation
- [ ] Navigation abstraction layer (NavMesh integration)
- [ ] Path following with steering behaviors
- [ ] Separation and avoidance

### NPC Types
- [ ] Guard AI (Patrol, Alert, Investigate, Combat)
- [ ] Enemy AI with adaptive behavior (GOAP)
- [ ] Boss AI with phase-based GOAP
- [ ] Ambient NPC AI (State Machine)
- [ ] Crowd/Formation AI (Squad coordination)

### Tuning & Polish
- [ ] Difficulty modifier system
- [ ] AI personality variation system
- [ ] AI LOD (Level of Detail) throttling
- [ ] AI debug visualization tools

### Testing
- [ ] Unit tests for BT execution, GOAP planning, Perception
- [ ] AI behavior documented per NPC type
- [ ] Test scenarios for each difficulty level
```
